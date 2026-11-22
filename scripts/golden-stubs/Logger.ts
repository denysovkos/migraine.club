// Stand-in for src/libs/Logger in golden scripts, whose top-level await tsx
// cannot load: goldens only need the pure functions that import it.
export const logger = { debug() {}, info() {}, warn() {}, error() {} };
