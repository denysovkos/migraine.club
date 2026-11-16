export type MohGuardrailStatus = 'low' | 'watch' | 'high';

export type MohGuardrailResult = {
  status: MohGuardrailStatus;
  title: string;
  text: string;
};

export function calculateMohGuardrail(acuteMedicationDays: number): MohGuardrailResult {
  if (acuteMedicationDays >= 15) {
    return {
      status: 'high',
      title: 'Higher medication-overuse concern',
      text: 'Acute medication use days are elevated in this period. This report is informational only; please review in clinical context.',
    };
  }
  if (acuteMedicationDays >= 10) {
    return {
      status: 'watch',
      title: 'Monitor medication-overuse risk',
      text: 'Acute medication use days are moderately elevated. Trend over time may help clinical discussion.',
    };
  }
  return {
    status: 'low',
    title: 'No conservative overuse signal',
    text: 'Acute medication use is below conservative guardrail thresholds for this period.',
  };
}
