import { auth } from '@clerk/nextjs/server';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { db } from '@/libs/DB';
import { medicationsCatalogSchema, userMedicationsSchema, userSchema } from '@/models/Schema';
import { containsCyrillic, cyrillicToLatinVariants } from '@/utils/transliterate';

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

function buildGreatestSimilarityExpr(args: { searchTextSql: any; queries: string[] }) {
  // drizzle doesn't let us reference SELECT aliases in ORDER BY reliably; keep expression explicit.
  const qs = args.queries.filter(Boolean).slice(0, 3);
  const parts = qs.map(q => sql`similarity(${args.searchTextSql}, ${q})`);
  if (parts.length === 0) {
    return sql<number>`0`.mapWith(Number);
  }
  if (parts.length === 1) {
    return sql<number>`${parts[0]}`.mapWith(Number);
  }
  if (parts.length === 2) {
    return sql<number>`greatest(${parts[0]}, ${parts[1]})`.mapWith(Number);
  }
  return sql<number>`greatest(${parts[0]}, ${parts[1]}, ${parts[2]})`.mapWith(Number);
}

function languageCatalogFilter(preferredLanguage: string) {
  if (preferredLanguage === 'uk') {
    // Ukrainian locale: show Cyrillic medication names only.
    return sql<boolean>`${medicationsCatalogSchema.canonicalName} ~ '[А-Яа-яЁёІіЇїЄєҐґ]'`;
  }
  // English/French locales: keep Latin-script names only to avoid mixed-language list.
  return sql<boolean>`${medicationsCatalogSchema.canonicalName} !~ '[А-Яа-яЁёІіЇїЄєҐґ]'`;
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasConsent = await hasHealthDataConsent(userId);
  if (!hasConsent) {
    return NextResponse.json(
      {
        error: 'Health data consent required',
        code: 'CONSENT_REQUIRED',
        message: 'You must provide explicit consent for health data processing before searching meds.',
      },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('q') ?? '';
  const q = normalizeQuery(raw);
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const [currentUser] = await db
    .select({ preferredLanguage: userSchema.preferredLanguage })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1);
  const preferredLanguage = currentUser?.preferredLanguage ?? 'en';
  const catalogLanguageFilter = languageCatalogFilter(preferredLanguage);

  const pattern = `%${q}%`;
  const qLatVars = containsCyrillic(q) ? cyrillicToLatinVariants(q, 3) : [];
  const qAlt = qLatVars.filter(v => v && v !== q).slice(0, 2);
  const patternsAlt = qAlt.map(v => `%${v}%`);

  const userResults = await db
    .select({
      kind: sql<'user'>`'user'`,
      userMedicationId: userMedicationsSchema.id,
      catalogMedicationId: userMedicationsSchema.catalogMedicationId,
      label: sql<string>`coalesce(${userMedicationsSchema.customName}, ${medicationsCatalogSchema.canonicalName})`,
      defaultDose: userMedicationsSchema.defaultDose,
      defaultUnit: userMedicationsSchema.defaultUnit,
      defaultUnitIsCustom: userMedicationsSchema.defaultUnitIsCustom,
      lastUsedDose: userMedicationsSchema.lastUsedDose,
      lastUsedUnit: userMedicationsSchema.lastUsedUnit,
      lastUsedUnitIsCustom: userMedicationsSchema.lastUsedUnitIsCustom,
      isPinned: userMedicationsSchema.isPinned,
    })
    .from(userMedicationsSchema)
    .leftJoin(
      medicationsCatalogSchema,
      eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
    )
    .where(
      and(
        eq(userMedicationsSchema.userId, userId),
        or(
          ilike(userMedicationsSchema.customName, pattern),
          ilike(medicationsCatalogSchema.searchText, pattern),
          ...patternsAlt.map(p => ilike(userMedicationsSchema.customName, p)),
          ...patternsAlt.map(p => ilike(medicationsCatalogSchema.searchText, p)),
        ),
      ),
    )
    .orderBy(desc(userMedicationsSchema.isPinned), desc(userMedicationsSchema.createdAt))
    .limit(20);

  const scoreExpr = buildGreatestSimilarityExpr({
    searchTextSql: medicationsCatalogSchema.searchText,
    queries: [q, ...qAlt],
  });

  const catalogResults = await db
    .select({
      kind: sql<'catalog'>`'catalog'`,
      catalogMedicationId: medicationsCatalogSchema.id,
      label: medicationsCatalogSchema.canonicalName,
      score: scoreExpr,
    })
    .from(medicationsCatalogSchema)
    .where(
      and(
        catalogLanguageFilter,
        or(
          ilike(medicationsCatalogSchema.searchText, pattern),
          // trigram match operator (uses pg_trgm + GIN)
          sql<boolean>`${medicationsCatalogSchema.searchText} % ${q}`,
          ...patternsAlt.map(p => ilike(medicationsCatalogSchema.searchText, p)),
          ...qAlt.map(v => sql<boolean>`${medicationsCatalogSchema.searchText} % ${v}`),
        ),
      ),
    )
    .orderBy(desc(scoreExpr), medicationsCatalogSchema.canonicalName)
    .limit(20);

  // De-dupe catalog hits that the user already has (by catalogMedicationId)
  const ownedCatalogIds = new Set(
    userResults.map(r => r.catalogMedicationId ?? '').filter(Boolean),
  );
  const filteredCatalog = catalogResults
    .filter(r => !ownedCatalogIds.has((r as any).catalogMedicationId))
    .map(({ score, ...rest }) => rest);

  // Prefer user meds first.
  return NextResponse.json({
    results: [...userResults, ...filteredCatalog].slice(0, 20),
  });
}

export const dynamic = 'force-dynamic';
