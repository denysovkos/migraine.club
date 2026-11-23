package profile

import (
	"fmt"
	"math"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

var adjectives = []string{
	"Calm", "Gentle", "Quiet", "Serene", "Peaceful", "Tranquil", "Mellow",
	"Bright", "Kind", "Brave", "Swift", "Wise", "Noble", "Warm",
	"Misty", "Sunny", "Starry", "Crystal", "Forest", "Ocean", "Mountain",
	"Azure", "Golden", "Silver", "Coral", "Amber", "Jade", "Violet",
	"Cloudy", "Breezy", "Stormy", "Snowy", "Rainy", "Windy", "Frosty",
}

var animals = []string{
	"Falcon", "Owl", "Eagle", "Sparrow", "Robin", "Heron", "Swan", "Dove",
	"Fox", "Wolf", "Bear", "Deer", "Lynx", "Otter", "Hare", "Badger",
	"Dolphin", "Whale", "Seal", "Turtle", "Starfish", "Seahorse",
	"Phoenix", "Dragon", "Griffin", "Unicorn",
	"Butterfly", "Dragonfly", "Firefly", "Panda", "Koala", "Penguin",
}

// pick indexes like a JavaScript array: a negative index is undefined.
func pick(list []string, idx float64) string {
	if idx < 0 || int(idx) >= len(list) {
		return "undefined"
	}
	return list[int(idx)]
}

// DisplayNameFromSeed is generateDisplayNameFromSeed from
// src/utils/displayNameGenerator.ts, including its 32-bit hash arithmetic.
func DisplayNameFromSeed(seed string) string {
	var hash float64
	for _, c := range jsx.CharCodes(seed) {
		shifted := float64(jsx.ToInt32(hash) << 5)
		hash = float64(jsx.ToInt32(shifted - hash + float64(c)))
	}
	hash = math.Abs(hash)
	adjective := pick(adjectives, math.Mod(hash, float64(len(adjectives))))
	// (hash >> 8) % n: the shift applies ToInt32 first; -0 indexes element 0.
	animalIdx := math.Mod(float64(jsx.ToInt32(hash)>>8), float64(len(animals)))
	if animalIdx == 0 {
		animalIdx = 0
	}
	animal := pick(animals, animalIdx)
	suffix := math.Mod(hash, 900) + 100
	return fmt.Sprintf("%s %s #%d", adjective, animal, int(suffix))
}

// IsValidDisplayName is isValidDisplayName.
func IsValidDisplayName(name string) bool {
	if name == "" {
		return false
	}
	n := jsx.Len(jsx.Trim(name))
	return n >= 2 && n <= 50
}

// SanitizeDisplayName is sanitizeDisplayName: trimmed, at most 50 code units.
func SanitizeDisplayName(name string) string {
	if name == "" {
		return ""
	}
	return jsx.Slice(jsx.Trim(name), 0, 50)
}
