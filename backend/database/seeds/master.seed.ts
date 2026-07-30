import { db } from '../../src/config/database';
import { seedChecklists } from './checklist.seed';
import { hashPassword } from '../../src/utils/helpers';
import { logger } from '../../src/utils/logger';

async function seedSettings(): Promise<void> {
  const settings = [
    { key: 'APP_NAME', value: 'CMMS Pro', description: 'Application name' },
    { key: 'COMPANY_NAME', value: 'Rukman Udyog', description: 'Company name' },
    ...['USR','MAC','DEP','SHF','ROL','TMP','ITM','TSK','RSP','VRF','ASN','MAP','NTF','LOG'].map(k => ({ key: `COUNTER_${k}`, value: '0', description: `Counter` }))
  ];
  for (const s of settings) {
    await db.query(`INSERT INTO settings (key, value, description) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`, [s.key, s.value, s.description]);
  }
  logger.info('✅ Settings seeded');
}

async function seedRoles(): Promise<void> {
  const roles = [
    { id: 'ROL001', name: 'Admin' },
    { id: 'ROL002', name: 'MD' },
    { id: 'ROL003', name: 'CEO' },
    { id: 'ROL004', name: 'MR' },
    { id: 'ROL005', name: 'Production Head' },
    { id: 'ROL006', name: 'Production AM/DM' },
    { id: 'ROL007', name: 'Production Supervisor' },
    { id: 'ROL008', name: 'NPD Head' },
    { id: 'ROL009', name: 'NPD Manager' },
    { id: 'ROL010', name: 'NPD Executive' },
    { id: 'ROL011', name: 'Business Development' },
    { id: 'ROL012', name: 'Purchase Head' },
    { id: 'ROL013', name: 'Purchase Executive' },
    { id: 'ROL014', name: 'Quality Head' },
    { id: 'ROL015', name: 'Quality Engineer' },
    { id: 'ROL016', name: 'Quality Inspector' },
    { id: 'ROL017', name: 'HR' },
    { id: 'ROL018', name: 'Account Head' },
    { id: 'ROL019', name: 'Account Executive' },
    { id: 'ROL020', name: 'Sr Accountant' },
    { id: 'ROL021', name: 'Marketing' },
    { id: 'ROL022', name: 'Store In-Charge' },
    { id: 'ROL023', name: 'Maintenance Incharge' },
    { id: 'ROL024', name: 'Executive' },
    { id: 'ROL025', name: 'Operator' },
    { id: 'ROL026', name: 'Helper' },
    { id: 'ROL027', name: 'MIS Executive' },
    { id: 'ROL028', name: 'Process Coordinator' },
  ];
  for (const r of roles) {
    await db.query(
      `INSERT INTO roles (role_id, role_name, permissions) VALUES ($1, $2, $3) ON CONFLICT (role_id) DO NOTHING`,
      [r.id, r.name, JSON.stringify({})]
    );
  }
  await db.query(`UPDATE settings SET value = '${roles.length}' WHERE key = 'COUNTER_ROL'`);
  logger.info(`✅ Roles seeded (${roles.length} roles)`);
}

async function seedDepartments(): Promise<void> {
  const depts = [
    { id: 'DEP001', name: 'Assembly',                    code: 'ASM' },
    { id: 'DEP002', name: 'Paint Shop',                  code: 'PNT' },
    { id: 'DEP003', name: 'Quality',                     code: 'QC'  },
    { id: 'DEP004', name: 'Sanding',                     code: 'SND' },
    { id: 'DEP005', name: 'PDI (Pre Dispatch Inspection)',code: 'PDI' },
    { id: 'DEP006', name: 'Packaging',                   code: 'PKG' },
    { id: 'DEP007', name: 'Dispatch',                    code: 'DSP' },
    { id: 'DEP008', name: 'Store',                       code: 'STR' },
    { id: 'DEP009', name: 'Moulding',                    code: 'MLD' },
    { id: 'DEP010', name: 'Purchase',                    code: 'PUR' },
    { id: 'DEP011', name: 'Housekeeping',                code: 'HK'  },
    { id: 'DEP012', name: 'Pantry',                      code: 'PNR' },
    { id: 'DEP013', name: 'Accounts',                    code: 'ACC' },
    { id: 'DEP014', name: 'NPD (New Product Development)',code: 'NPD' },
    { id: 'DEP015', name: 'BD (Business Development)',   code: 'BD'  },
    { id: 'DEP016', name: 'MDO',                         code: 'MDO' },
  ];
  for (const d of depts) {
    await db.query(
      `INSERT INTO departments (dept_id, dept_name, dept_code) VALUES ($1, $2, $3) ON CONFLICT (dept_id) DO NOTHING`,
      [d.id, d.name, d.code]
    );
  }
  await db.query(`UPDATE settings SET value = '${depts.length}' WHERE key = 'COUNTER_DEP'`);
  logger.info(`✅ Departments seeded (${depts.length} departments)`);
}

async function seedShifts(): Promise<void> {
  const shifts = [
    { id: 'SHF001', name: 'Shift A',       start: '06:00:00', end: '14:00:00' },
    { id: 'SHF002', name: 'Shift B',       start: '14:00:00', end: '22:00:00' },
    { id: 'SHF003', name: 'General Shift', start: '09:00:00', end: '18:00:00' },
  ];
  for (const s of shifts) {
    await db.query(
      `INSERT INTO shifts (shift_id, shift_name, start_time, end_time) VALUES ($1, $2, $3, $4) ON CONFLICT (shift_id) DO NOTHING`,
      [s.id, s.name, s.start, s.end]
    );
  }
  await db.query(`UPDATE settings SET value = '${shifts.length}' WHERE key = 'COUNTER_SHF'`);
  logger.info(`✅ Shifts seeded (Shift A, Shift B, General Shift)`);
}

async function seedDefaultAdmin(): Promise<void> {
  const [rows] = await db.execute<any>(`SELECT user_id FROM users WHERE username = $1`, ['admin']);
  if ((rows as any[]).length > 0) { logger.info('ℹ️  Admin already exists'); return; }
  const hash = await hashPassword('Admin@1234');
  await db.query(
    `INSERT INTO users (user_id, employee_code, full_name, username, password_hash, role_id, dept_id, shift_id, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['USR000001','EMP-ADM-001','System Administrator','admin',hash,'ROL001','DEP016','SHF003','admin@rukman.com']
  );
  await db.query(`UPDATE settings SET value = '1' WHERE key = 'COUNTER_USR'`);
  logger.info('✅ Default admin created — Username: admin | Password: Admin@1234');
}

export async function runSeeds(): Promise<void> {
  logger.info('🌱 Starting database seeding...');
  await seedSettings();
  await seedRoles();
  await seedDepartments();
  await seedShifts();
  await seedDefaultAdmin();
  await seedChecklists();
  logger.info('🎉 All seeds completed!');
}
