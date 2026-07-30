/**
 * checklist.service.ts
 * ────────────────────
 * Checklist template + items + machine assignment logic.
 *
 * Functions:
 * - getAllTemplates()        → list templates with filters
 * - getTemplateById()       → single template with all items
 * - createTemplate()        → create new checklist template
 * - updateTemplate()        → update template info
 * - addItem()               → add item to template
 * - updateItem()            → update checklist item
 * - deleteItem()            → remove item
 * - reorderItems()          → drag-drop reorder
 * - assignToMachine()       → link template to machine with schedule
 * - unassignFromMachine()   → remove template from machine
 * - getMachineTemplates()   → all templates for a machine
 */

import { db } from '../../config/database';
import { TABLE, FREQUENCY, PHOTO_REQUIRED_FREQUENCIES, FrequencyType } from '../../config/constants';
import { generateId } from '../../utils/idGenerator';
import { AppErrors } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { parsePagination, buildPaginationMeta } from '../../utils/helpers';

// ── Types ────────────────────────────────────────────────────────

export interface ChecklistTemplate {
  templateId:   string;
  templateName: string;
  deptId:       string;
  deptName:     string;
  frequency:    string;
  hasPhoto:     boolean;
  description:  string | null;
  isActive:     boolean;
  itemCount:    number;
  createdAt:    string;
  items?:       ChecklistItem[];
}

export interface ChecklistItem {
  itemId:          string;
  templateId:      string;
  itemText:        string;
  inputType:       string;
  isMandatory:     boolean;
  dropdownOptions: string[] | null;
  expectedValue:   string | null;
  minValue:        number | null;
  maxValue:        number | null;
  unit:            string | null;
  sortOrder:       number;
}

export interface CreateTemplateDto {
  templateName: string;
  deptId:       string;
  frequency:    FrequencyType;
  description?: string;
}

export interface CreateItemDto {
  itemText:         string;
  inputType:        string;
  isMandatory?:     boolean;
  dropdownOptions?: string[];
  expectedValue?:   string;
  minValue?:        number;
  maxValue?:        number;
  unit?:            string;
}

export interface AssignToMachineDto {
  machineId:          string;
  scheduleStartDate:  string;
  scheduleDay?:       number; // 1-7 for weekly, 1-31 for monthly
}

// ── Get all templates ─────────────────────────────────────────────

export async function getAllTemplates(query: Record<string, unknown>) {
  const { page, limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.deptId)    { conditions.push('t.dept_id = ?');   params.push(query.deptId); }
  if (query.frequency) { conditions.push('t.frequency = ?'); params.push(query.frequency); }
  if (query.search) {
    conditions.push('t.template_name LIKE ?');
    params.push(`%${query.search}%`);
  }
  if (query.showInactive !== 'true') { conditions.push('t.is_active = true'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await db.execute<any[]>(
    `SELECT
       t.template_id,   t.template_name,  t.frequency,
       t.has_photo,     t.description,    t.is_active,  t.created_at,
       t.dept_id,       d.dept_name,
       COUNT(i.item_id) AS item_count
     FROM ${TABLE.CHECKLIST_TEMPLATES} t
     JOIN ${TABLE.DEPARTMENTS} d  ON t.dept_id    = d.dept_id
     LEFT JOIN ${TABLE.CHECKLIST_ITEMS} i ON t.template_id = i.template_id AND i.is_active = true
     ${where}
     GROUP BY t.template_id, t.template_name, t.frequency, t.has_photo,
              t.description, t.is_active, t.created_at, t.dept_id, d.dept_name
     ORDER BY t.template_name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows] = await db.execute<any[]>(
    `SELECT COUNT(*) FROM ${TABLE.CHECKLIST_TEMPLATES} t ${where}`,
    params
  );

  return {
    data: rows.map(mapTemplate),
    meta: buildPaginationMeta(Number(countRows[0]?.count || countRows[0]?.total || 0), page, limit),
  };
}

// ── Get template by ID with all items ────────────────────────────

export async function getTemplateById(templateId: string): Promise<ChecklistTemplate> {
  const [tRows] = await db.execute<any[]>(
    `SELECT
       t.template_id,   t.template_name,  t.frequency,
       t.has_photo,     t.description,    t.is_active,  t.created_at,
       t.dept_id,       d.dept_name,
       COUNT(i.item_id) AS item_count
     FROM ${TABLE.CHECKLIST_TEMPLATES} t
     JOIN ${TABLE.DEPARTMENTS} d ON t.dept_id = d.dept_id
     LEFT JOIN ${TABLE.CHECKLIST_ITEMS} i ON t.template_id = i.template_id AND i.is_active = true
     WHERE t.template_id = ?
     GROUP BY t.template_id, t.template_name, t.frequency, t.has_photo,
              t.description, t.is_active, t.created_at, t.dept_id, d.dept_name`,
    [templateId]
  );

  if (tRows.length === 0) throw AppErrors.notFound('Checklist template');

  const template = mapTemplate(tRows[0]);

  // Fetch items
  const [itemRows] = await db.execute<any[]>(
    `SELECT * FROM ${TABLE.CHECKLIST_ITEMS}
     WHERE template_id = ? AND is_active = true
     ORDER BY sort_order ASC`,
    [templateId]
  );

  template.items = itemRows.map(mapItem);
  return template;
}

// ── Create template ───────────────────────────────────────────────

export async function createTemplate(
  dto: CreateTemplateDto,
  createdBy: string
): Promise<ChecklistTemplate> {
  const templateId = await generateId('TMP');

  // Auto-set hasPhoto based on frequency
  const hasPhoto = PHOTO_REQUIRED_FREQUENCIES.includes(dto.frequency) ? 1 : 0;

  await db.query(
    `INSERT INTO ${TABLE.CHECKLIST_TEMPLATES}
       (template_id, template_name, dept_id, frequency, has_photo, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [templateId, dto.templateName.trim(), dto.deptId, dto.frequency,
     hasPhoto, dto.description || null, createdBy]
  );

  logger.info(`Template created: ${templateId} — ${dto.templateName}`);
  return getTemplateById(templateId);
}

// ── Update template ───────────────────────────────────────────────

export async function updateTemplate(
  templateId: string,
  dto: Partial<CreateTemplateDto>,
  updatedBy: string
): Promise<ChecklistTemplate> {
  await getTemplateById(templateId);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (dto.templateName) { fields.push('template_name = ?'); values.push(dto.templateName.trim()); }
  if (dto.deptId)       { fields.push('dept_id = ?');       values.push(dto.deptId); }
  if (dto.description !== undefined) { fields.push('description = ?'); values.push(dto.description); }

  if (dto.frequency) {
    fields.push('frequency = ?');
    fields.push('has_photo = ?');
    values.push(dto.frequency);
    values.push(PHOTO_REQUIRED_FREQUENCIES.includes(dto.frequency) ? 1 : 0);
  }

  if (fields.length === 0) throw AppErrors.badRequest('No fields to update.');
  fields.push('updated_at = NOW()');
  values.push(templateId);

  await db.query(
    `UPDATE ${TABLE.CHECKLIST_TEMPLATES} SET ${fields.join(', ')} WHERE template_id = ?`,
    values
  );

  return getTemplateById(templateId);
}

// ── Add item to template ──────────────────────────────────────────

export async function addItem(
  templateId: string,
  dto: CreateItemDto,
  createdBy: string
): Promise<ChecklistItem> {
  await getTemplateById(templateId);

  // Get max sort_order
  const [maxRows] = await db.execute<any[]>(
    `SELECT COALESCE(MAX(sort_order), 0) AS max_order
     FROM ${TABLE.CHECKLIST_ITEMS} WHERE template_id = ?`,
    [templateId]
  );

  const sortOrder = maxRows[0].max_order + 1;
  const itemId    = await generateId('ITM');

  const dropdownStr = dto.dropdownOptions?.length
    ? dto.dropdownOptions.join(',')
    : null;

  await db.query(
    `INSERT INTO ${TABLE.CHECKLIST_ITEMS}
       (item_id, template_id, item_text, input_type, is_mandatory,
        dropdown_options, expected_value, min_value, max_value, unit, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      itemId, templateId, dto.itemText.trim(), dto.inputType,
      dto.isMandatory !== false ? 1 : 0,
      dropdownStr, dto.expectedValue || null,
      dto.minValue ?? null, dto.maxValue ?? null,
      dto.unit || null, sortOrder,
    ]
  );

  logger.info(`Item added: ${itemId} to template ${templateId}`);

  const [rows] = await db.execute<any[]>(
    `SELECT * FROM ${TABLE.CHECKLIST_ITEMS} WHERE item_id = ?`,
    [itemId]
  );
  return mapItem(rows[0]);
}

// ── Update item ───────────────────────────────────────────────────

export async function updateItem(
  itemId: string,
  dto: Partial<CreateItemDto>
): Promise<ChecklistItem> {
  const [existing] = await db.execute<any[]>(
    `SELECT item_id FROM ${TABLE.CHECKLIST_ITEMS} WHERE item_id = ? AND is_active = true`,
    [itemId]
  );
  if (existing.length === 0) throw AppErrors.notFound('Checklist item');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (dto.itemText)    { fields.push('item_text = ?');    values.push(dto.itemText.trim()); }
  if (dto.inputType)   { fields.push('input_type = ?');   values.push(dto.inputType); }
  if (dto.isMandatory !== undefined) { fields.push('is_mandatory = ?'); values.push(dto.isMandatory ? 1 : 0); }
  if (dto.expectedValue !== undefined) { fields.push('expected_value = ?'); values.push(dto.expectedValue); }
  if (dto.minValue !== undefined) { fields.push('min_value = ?'); values.push(dto.minValue); }
  if (dto.maxValue !== undefined) { fields.push('max_value = ?'); values.push(dto.maxValue); }
  if (dto.unit !== undefined)     { fields.push('unit = ?');      values.push(dto.unit); }
  if (dto.dropdownOptions) {
    fields.push('dropdown_options = ?');
    values.push(dto.dropdownOptions.join(','));
  }

  if (fields.length === 0) throw AppErrors.badRequest('No fields to update.');
  values.push(itemId);

  await db.query(
    `UPDATE ${TABLE.CHECKLIST_ITEMS} SET ${fields.join(', ')} WHERE item_id = ?`,
    values
  );

  const [rows] = await db.execute<any[]>(
    `SELECT * FROM ${TABLE.CHECKLIST_ITEMS} WHERE item_id = ?`,
    [itemId]
  );
  return mapItem(rows[0]);
}

// ── Delete item (soft delete) ─────────────────────────────────────

export async function deleteItem(itemId: string): Promise<void> {
  await db.query(
    `UPDATE ${TABLE.CHECKLIST_ITEMS} SET is_active = false WHERE item_id = ?`,
    [itemId]
  );
}

// ── Reorder items ─────────────────────────────────────────────────

export async function reorderItems(
  templateId: string,
  itemOrders: { itemId: string; sortOrder: number }[]
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const { itemId, sortOrder } of itemOrders) {
      await conn.execute(
        `UPDATE ${TABLE.CHECKLIST_ITEMS} SET sort_order = ? WHERE item_id = ? AND template_id = ?`,
        [sortOrder, itemId, templateId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Assign template to machine ────────────────────────────────────

export async function assignToMachine(
  templateId: string,
  dto: AssignToMachineDto,
  assignedBy: string
): Promise<void> {
  // Check if already assigned
  const [existing] = await db.execute<any[]>(
    `SELECT map_id FROM ${TABLE.MACHINE_TEMPLATE_MAP}
     WHERE machine_id = ? AND template_id = ?`,
    [dto.machineId, templateId]
  );

  if (existing.length > 0) {
    // Reactivate + update schedule if already exists
    await db.query(
      `UPDATE ${TABLE.MACHINE_TEMPLATE_MAP}
       SET is_active = true, schedule_start_date = ?, schedule_day = ?,
           assigned_by = ?, assigned_date = NOW(), last_generated_date = NULL
       WHERE machine_id = ? AND template_id = ?`,
      [dto.scheduleStartDate, dto.scheduleDay || null, assignedBy, dto.machineId, templateId]
    );
  } else {
    const mapId = await generateId('MAP');
    await db.query(
      `INSERT INTO ${TABLE.MACHINE_TEMPLATE_MAP}
         (map_id, machine_id, template_id, is_active,
          schedule_start_date, schedule_day, assigned_by)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [mapId, dto.machineId, templateId, dto.scheduleStartDate, dto.scheduleDay || null, assignedBy]
    );
  }

  logger.info(`Template ${templateId} assigned to machine ${dto.machineId} by ${assignedBy}`);
}

// ── Unassign template from machine ────────────────────────────────

export async function unassignFromMachine(
  templateId: string,
  machineId:  string
): Promise<void> {
  await db.query(
    `UPDATE ${TABLE.MACHINE_TEMPLATE_MAP}
     SET is_active = false WHERE machine_id = ? AND template_id = ?`,
    [machineId, templateId]
  );
}

// ── Get all templates for a machine ──────────────────────────────

export async function getMachineTemplates(machineId: string) {
  const [rows] = await db.execute<any[]>(
    `SELECT
       t.template_id,   t.template_name,  t.frequency,
       t.has_photo,     t.is_active,
       mtm.schedule_start_date, mtm.schedule_day, mtm.last_generated_date,
       mtm.is_active AS assignment_active,
       COUNT(i.item_id) AS item_count
     FROM ${TABLE.MACHINE_TEMPLATE_MAP} mtm
     JOIN ${TABLE.CHECKLIST_TEMPLATES} t ON mtm.template_id = t.template_id
     LEFT JOIN ${TABLE.CHECKLIST_ITEMS} i ON t.template_id  = i.template_id AND i.is_active = true
     WHERE mtm.machine_id = ? AND mtm.is_active = true
     GROUP BY t.template_id, t.template_name, t.frequency, t.has_photo,
              t.description, t.is_active, t.created_at, t.dept_id,
              d.dept_name, mtm.map_id, mtm.schedule_start_date, mtm.is_active
     ORDER BY t.frequency, t.template_name`,
    [machineId]
  );

  return rows;
}

// ── Mappers ───────────────────────────────────────────────────────

function mapTemplate(row: any): ChecklistTemplate {
  return {
    templateId:   row.template_id,
    templateName: row.template_name,
    deptId:       row.dept_id,
    deptName:     row.dept_name,
    frequency:    row.frequency,
    hasPhoto:     Boolean(row.has_photo),
    description:  row.description,
    isActive:     Boolean(row.is_active),
    itemCount:    Number(row.item_count || 0),
    createdAt:    row.created_at,
  };
}

function mapItem(row: any): ChecklistItem {
  return {
    itemId:          row.item_id,
    templateId:      row.template_id,
    itemText:        row.item_text,
    inputType:       row.input_type,
    isMandatory:     Boolean(row.is_mandatory),
    dropdownOptions: row.dropdown_options ? row.dropdown_options.split(',') : null,
    expectedValue:   row.expected_value,
    minValue:        row.min_value,
    maxValue:        row.max_value,
    unit:            row.unit,
    sortOrder:       row.sort_order,
  };
}
