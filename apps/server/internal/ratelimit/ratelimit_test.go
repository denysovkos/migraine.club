package ratelimit

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time      { return c.t }
func (c *fakeClock) add(d time.Duration) { c.t = c.t.Add(d) }
func newClock() *fakeClock               { return &fakeClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)} }
func allowN(l *Limiter, key string, n int) int {
	ok := 0
	for range n {
		if a, _ := l.Allow(key); a {
			ok++
		}
	}
	return ok
}

func TestBurstThenRefusesWithRetryAfter(t *testing.T) {
	c := newClock()
	l := New(Limit{PerMinute: 60, Burst: 5}, c.now, 100)
	if got := allowN(l, "a", 5); got != 5 {
		t.Fatalf("burst allowed %d, want 5", got)
	}
	ok, wait := l.Allow("a")
	if ok {
		t.Fatal("request past the burst was allowed")
	}
	if wait != time.Second {
		t.Fatalf("wait = %v, want 1s at 60/min", wait)
	}
}

func TestRefillsAtTheSustainedRate(t *testing.T) {
	c := newClock()
	l := New(Limit{PerMinute: 60, Burst: 5}, c.now, 100)
	allowN(l, "a", 5)
	c.add(3 * time.Second)
	if got := allowN(l, "a", 10); got != 3 {
		t.Fatalf("after 3s allowed %d, want 3", got)
	}
	c.add(time.Hour)
	if got := allowN(l, "a", 10); got != 5 {
		t.Fatalf("refill is capped at the burst: allowed %d, want 5", got)
	}
}

func TestKeysAreIndependent(t *testing.T) {
	c := newClock()
	l := New(Limit{PerMinute: 60, Burst: 2}, c.now, 100)
	allowN(l, "a", 5)
	if got := allowN(l, "b", 2); got != 2 {
		t.Fatalf("key b allowed %d, want its own burst of 2", got)
	}
}

func TestSweepForgetsRefilledKeys(t *testing.T) {
	c := newClock()
	l := New(Limit{PerMinute: 60, Burst: 2}, c.now, 100)
	allowN(l, "a", 1)
	allowN(l, "b", 2)
	c.add(sweepEvery)
	allowN(l, "c", 1)
	if l.Len() != 1 {
		t.Fatalf("held %d buckets after the sweep, want only c", l.Len())
	}
}

func TestFullTableLetsNewKeysThrough(t *testing.T) {
	c := newClock()
	l := New(Limit{PerMinute: 1, Burst: 1}, c.now, 3)
	for i := range 3 {
		allowN(l, fmt.Sprint(i), 1)
	}
	if got := allowN(l, "new", 5); got != 5 {
		t.Fatalf("new key allowed %d of 5 with a full table, want all", got)
	}
	if l.Len() != 3 {
		t.Fatalf("table grew to %d, want it capped at 3", l.Len())
	}
	if ok, _ := l.Allow("0"); ok {
		t.Fatal("an existing key's limit stopped applying")
	}
}

func TestConcurrentUse(t *testing.T) {
	l := New(Limit{PerMinute: 1, Burst: 50}, nil, 100)
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for range 10 {
		wg.Go(func() {
			n := allowN(l, "a", 20)
			mu.Lock()
			allowed += n
			mu.Unlock()
		})
	}
	wg.Wait()
	if allowed != 50 {
		t.Fatalf("allowed %d across goroutines, want exactly the burst of 50", allowed)
	}
}
