// Package ratelimit keeps a token bucket per key in memory.
package ratelimit

import (
	"math"
	"sync"
	"time"
)

// Limit is a sustained rate with a burst on top.
type Limit struct {
	PerMinute int
	Burst     int
}

// sweepEvery is how often buckets that have refilled are dropped.
const sweepEvery = time.Minute

// Limiter holds one bucket per key. Keys whose bucket is full again are
// forgotten on the next sweep, so memory follows recent traffic only.
type Limiter struct {
	limit   Limit
	perSec  float64
	now     func() time.Time
	maxKeys int

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastSweep time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// New returns a limiter. maxKeys caps the number of buckets: once it is
// reached and a sweep frees nothing, new keys are let through rather than
// the memory growing without bound.
func New(l Limit, now func() time.Time, maxKeys int) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{
		limit:   l,
		perSec:  float64(l.PerMinute) / 60,
		now:     now,
		maxKeys: maxKeys,
		buckets: map[string]*bucket{},
	}
}

// Allow takes a token from key's bucket. When none is left it returns false
// and how long until the next one.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	if now.Sub(l.lastSweep) >= sweepEvery {
		l.sweep(now)
	}
	b, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= l.maxKeys {
			l.sweep(now)
			if len(l.buckets) >= l.maxKeys {
				return true, 0
			}
		}
		b = &bucket{tokens: float64(l.limit.Burst), last: now}
		l.buckets[key] = b
	}
	b.tokens = l.refilled(b, now)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := time.Duration(math.Ceil((1 - b.tokens) / l.perSec * float64(time.Second)))
	return false, wait
}

func (l *Limiter) refilled(b *bucket, now time.Time) float64 {
	elapsed := now.Sub(b.last).Seconds()
	if elapsed < 0 {
		elapsed = 0
	}
	return math.Min(float64(l.limit.Burst), b.tokens+elapsed*l.perSec)
}

func (l *Limiter) sweep(now time.Time) {
	for k, b := range l.buckets {
		if l.refilled(b, now) >= float64(l.limit.Burst) {
			delete(l.buckets, k)
		}
	}
	l.lastSweep = now
}

// Len reports how many buckets are held (for tests).
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
