/**
 * Display name generator - creates friendly "adjective + animal" names
 * for users who don't have a name from their auth provider.
 */

const ADJECTIVES = [
  // Calm/peaceful
  'Calm',
  'Gentle',
  'Quiet',
  'Serene',
  'Peaceful',
  'Tranquil',
  'Mellow',
  // Positive traits
  'Bright',
  'Kind',
  'Brave',
  'Swift',
  'Wise',
  'Noble',
  'Warm',
  // Nature-inspired
  'Misty',
  'Sunny',
  'Starry',
  'Crystal',
  'Forest',
  'Ocean',
  'Mountain',
  // Colors
  'Azure',
  'Golden',
  'Silver',
  'Coral',
  'Amber',
  'Jade',
  'Violet',
  // Weather
  'Cloudy',
  'Breezy',
  'Stormy',
  'Snowy',
  'Rainy',
  'Windy',
  'Frosty',
] as const;

const ANIMALS = [
  // Birds
  'Falcon',
  'Owl',
  'Eagle',
  'Sparrow',
  'Robin',
  'Heron',
  'Swan',
  'Dove',
  // Mammals
  'Fox',
  'Wolf',
  'Bear',
  'Deer',
  'Lynx',
  'Otter',
  'Hare',
  'Badger',
  // Sea creatures
  'Dolphin',
  'Whale',
  'Seal',
  'Turtle',
  'Starfish',
  'Seahorse',
  // Mythical feel
  'Phoenix',
  'Dragon',
  'Griffin',
  'Unicorn',
  // Other
  'Butterfly',
  'Dragonfly',
  'Firefly',
  'Panda',
  'Koala',
  'Penguin',
] as const;

/**
 * Generates a random display name in the format "Adjective Animal #XXX"
 * e.g., "Calm Falcon #482", "Bright Owl #127"
 */
export function generateDisplayName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const suffix = Math.floor(Math.random() * 900) + 100; // 100-999

  return `${adjective} ${animal} #${suffix}`;
}

/**
 * Generates a deterministic display name based on a seed (e.g., user ID)
 * This ensures the same user always gets the same generated name.
 */
export function generateDisplayNameFromSeed(seed: string): string {
  // Simple hash function for deterministic selection
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  hash = Math.abs(hash);

  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const animal = ANIMALS[(hash >> 8) % ANIMALS.length];
  const suffix = (hash % 900) + 100; // 100-999

  return `${adjective} ${animal} #${suffix}`;
}

/**
 * Validates that a display name is within acceptable bounds
 */
export function isValidDisplayName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  const trimmed = name.trim();

  // Minimum 2 characters, maximum 50 characters
  if (trimmed.length < 2 || trimmed.length > 50) {
    return false;
  }

  // Should not be only whitespace
  if (trimmed.length === 0) {
    return false;
  }

  return true;
}

/**
 * Sanitizes a display name by trimming and limiting length
 */
export function sanitizeDisplayName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  return name.trim().slice(0, 50);
}
