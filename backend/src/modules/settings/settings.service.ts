import path from 'path';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';

export async function getSettings() {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } });
  }
  return settings;
}

/** Resolves the current business's PDF branding — logo file path, font, page scale. */
export async function getPdfBrand() {
  const settings = await getSettings();
  return {
    logoPath: settings.logoUrl ? path.join(process.cwd(), env.uploadDir, path.basename(settings.logoUrl)) : undefined,
    fontFamily: settings.pdfFont,
    scale: settings.pdfScale,
    settings,
  };
}
