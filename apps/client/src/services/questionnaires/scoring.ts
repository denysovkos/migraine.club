import { z } from 'zod';

export const QuestionnaireType = {
  HIT6: 'HIT6',
  MIDAS: 'MIDAS',
  MSQ21: 'MSQ21',
} as const;
export type QuestionnaireTypeType = (typeof QuestionnaireType)[keyof typeof QuestionnaireType];

// --------------------
// HIT-6
// --------------------

export const Hit6Answer = {
  NEVER: 'NEVER',
  RARELY: 'RARELY',
  SOMETIMES: 'SOMETIMES',
  VERY_OFTEN: 'VERY_OFTEN',
  ALWAYS: 'ALWAYS',
} as const;
export type Hit6AnswerType = (typeof Hit6Answer)[keyof typeof Hit6Answer];

const Hit6AnswersSchema = z.object({
  q1: z.nativeEnum(Hit6Answer),
  q2: z.nativeEnum(Hit6Answer),
  q3: z.nativeEnum(Hit6Answer),
  q4: z.nativeEnum(Hit6Answer),
  q5: z.nativeEnum(Hit6Answer),
  q6: z.nativeEnum(Hit6Answer),
});

const HIT6_POINTS: Record<Hit6AnswerType, number> = {
  NEVER: 6,
  RARELY: 8,
  SOMETIMES: 10,
  VERY_OFTEN: 11,
  ALWAYS: 13,
};

export function scoreHit6(answers: unknown): { answers: any; scoreTotal: number } {
  const a = Hit6AnswersSchema.parse(answers);
  const scoreTotal = (Object.values(a) as Hit6AnswerType[])
    .reduce((sum, v) => sum + HIT6_POINTS[v], 0);
  return { answers: a, scoreTotal };
}

// --------------------
// MIDAS
// --------------------

const MidasAnswersSchema = z.object({
  q1: z.number().int().min(0).max(180),
  q2: z.number().int().min(0).max(180),
  q3: z.number().int().min(0).max(180),
  q4: z.number().int().min(0).max(180),
  q5: z.number().int().min(0).max(180),
});

export type MidasGrade = 'Grade I' | 'Grade II' | 'Grade III' | 'Grade IV';

export function midasGrade(total: number): MidasGrade {
  if (total <= 5) {
    return 'Grade I';
  }
  if (total <= 10) {
    return 'Grade II';
  }
  if (total <= 20) {
    return 'Grade III';
  }
  return 'Grade IV';
}

export function scoreMidas(answers: unknown): {
  answers: any;
  scoreTotal: number;
  scoreDetails: { grade: MidasGrade };
} {
  const a = MidasAnswersSchema.parse(answers);
  const scoreTotal = a.q1 + a.q2 + a.q3 + a.q4 + a.q5;
  return { answers: a, scoreTotal, scoreDetails: { grade: midasGrade(scoreTotal) } };
}

// --------------------
// MSQ v2.1 (Optional/Advanced)
// --------------------

// 14 questions, 6-point frequency scale
const MsqAnswerSchema = z.number().int().min(1).max(6);
const MsqAnswersSchema = z.object({
  q1: MsqAnswerSchema,
  q2: MsqAnswerSchema,
  q3: MsqAnswerSchema,
  q4: MsqAnswerSchema,
  q5: MsqAnswerSchema,
  q6: MsqAnswerSchema,
  q7: MsqAnswerSchema,
  q8: MsqAnswerSchema,
  q9: MsqAnswerSchema,
  q10: MsqAnswerSchema,
  q11: MsqAnswerSchema,
  q12: MsqAnswerSchema,
  q13: MsqAnswerSchema,
  q14: MsqAnswerSchema,
});

type MsqDomainScores = {
  restrictive: number;
  preventive: number;
  emotional: number;
  total: number;
};

function transformMsqScore(sum: number, items: number): number {
  // Standard 0–100 transform for 1..6 per item:
  // avg in [1..6] -> (avg - 1)/5 * 100
  const avg = sum / items;
  const val = ((avg - 1) / 5) * 100;
  return Math.round(val * 10) / 10;
}

export function scoreMsq21(answers: unknown): {
  answers: any;
  scoreTotal: number;
  scoreDetails: { domains: MsqDomainScores };
} {
  const a = MsqAnswersSchema.parse(answers);

  // Domain item groupings (v2.1):
  // - Role Function-Restrictive: 1,2,3,4,5,6,7 (7 items)
  // - Role Function-Preventive: 8,9,10,11 (4 items)
  // - Emotional Function: 12,13,14 (3 items)
  const restrictiveSum = a.q1 + a.q2 + a.q3 + a.q4 + a.q5 + a.q6 + a.q7;
  const preventiveSum = a.q8 + a.q9 + a.q10 + a.q11;
  const emotionalSum = a.q12 + a.q13 + a.q14;

  const restrictive = transformMsqScore(restrictiveSum, 7);
  const preventive = transformMsqScore(preventiveSum, 4);
  const emotional = transformMsqScore(emotionalSum, 3);
  const total = transformMsqScore(
    restrictiveSum + preventiveSum + emotionalSum,
    14,
  );

  return {
    answers: a,
    scoreTotal: Math.round(total),
    scoreDetails: {
      domains: { restrictive, preventive, emotional, total },
    },
  };
}

export function scoreQuestionnaire(args: { type: QuestionnaireTypeType; answers: unknown }): {
  normalizedAnswers: any;
  scoreTotal: number | null;
  scoreDetails: any | null;
} {
  switch (args.type) {
    case QuestionnaireType.HIT6: {
      const res = scoreHit6(args.answers);
      return { normalizedAnswers: res.answers, scoreTotal: res.scoreTotal, scoreDetails: null };
    }
    case QuestionnaireType.MIDAS: {
      const res = scoreMidas(args.answers);
      return { normalizedAnswers: res.answers, scoreTotal: res.scoreTotal, scoreDetails: res.scoreDetails };
    }
    case QuestionnaireType.MSQ21: {
      const res = scoreMsq21(args.answers);
      return { normalizedAnswers: res.answers, scoreTotal: res.scoreTotal, scoreDetails: res.scoreDetails };
    }
    default: {
      return { normalizedAnswers: args.answers, scoreTotal: null, scoreDetails: null };
    }
  }
}
