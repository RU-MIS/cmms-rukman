import path from 'path';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';

export async function getSettings(companyId: number) {
  let settings = await prisma.settings.findUnique({ where: { companyId } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { companyId } });
  }
  return settings;
}

/** Resolves the current business's PDF branding — logo file path, font, page scale. */
export async function getPdfBrand(companyId: number) {
  const settings = await getSettings(companyId);
  return {
    logoPath: settings.logoUrl ? path.join(process.cwd(), env.uploadDir, path.basename(settings.logoUrl)) : undefined,
    fontFamily: settings.pdfFont,
    scale: settings.pdfScale,
    settings,
  };
}
