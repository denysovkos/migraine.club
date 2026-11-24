# Programs content

Each program is a pair: a `<id>.json` file holding the validated frontmatter, and a `<id>.md` file holding the body rendered on the program detail page.

The frontmatter schema is `src/services/programs/programDefinitionSchema.ts`. The loader (`src/services/programs/programDefinitions.ts`) reads both files and validates the JSON.

i18n: file names are stable identifiers. Translated bodies sit next to the English one as `<id>.<locale>.md` (for example `sleep-regularity.fr.md`, `sleep-regularity.uk.md`).
