import type { DocumentProps } from '@react-pdf/renderer';

import type { Buffer } from 'node:buffer';
import type { ReactElement } from 'react';
import type { ClinicianReportModel } from '@/services/reports/clinician/model';
import { renderToBuffer } from '@react-pdf/renderer';

import { createElement } from 'react';
import { ClinicianReportPdfDocument } from '@/services/reports/clinician/renderPdf';

export async function renderClinicianReportPdf(model: ClinicianReportModel): Promise<Buffer> {
  const documentElement = createElement(ClinicianReportPdfDocument, { model }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(documentElement);
}
