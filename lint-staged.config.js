module.exports = {
  // Only run ESLint on files it can actually parse. Previously this used '*'
  // which included .json / .md / .sql and tripped lint-staged's stash-restore
  // (silent no-op modifications cause merge conflicts on restore).
  '**/*.{js,jsx,ts,tsx,mjs,cjs}': ['eslint --fix --no-warn-ignored'],
  '**/*.ts?(x)': () => 'npm run check-types',
};
