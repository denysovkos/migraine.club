import { tableFeatures } from '@tanstack/react-table';

// Plain read-only tables: no sorting, filtering or selection. TanStack Table v9
// requires features to be registered explicitly; the core row model is built in.
export const basicTableFeatures = tableFeatures({});

export type BasicTableFeatures = typeof basicTableFeatures;
