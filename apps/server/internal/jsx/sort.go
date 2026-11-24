package jsx

import "math"

// SortJS is Array.prototype.sort with a comparator, as V8 implements it
// (third_party/v8/builtins/array-sort.tq, a TimSort): for a consistent
// comparator any stable sort gives the same order, but comparators that
// return NaN (treated as 0) or are not transitive produce V8's exact order
// only with V8's exact algorithm.
func SortJS[T any](xs []T, cmp func(a, b T) float64) {
	s := &timSort[T]{a: xs, cmp: cmp, minGallop: 7}
	s.sort()
}

const minGallopWins = 7

type run struct{ base, length int }

type timSort[T any] struct {
	a         []T
	cmp       func(a, b T) float64
	minGallop int
	runs      []run
}

func (s *timSort[T]) compare(x, y T) float64 {
	v := s.cmp(x, y)
	if math.IsNaN(v) {
		return 0
	}
	return v
}

func minRunLength(n int) int {
	r := 0
	for n >= 64 {
		r |= n & 1
		n >>= 1
	}
	return n + r
}

func (s *timSort[T]) sort() {
	length := len(s.a)
	if length < 2 {
		return
	}
	remaining, low := length, 0
	minRun := minRunLength(remaining)
	for remaining != 0 {
		cur := s.countAndMakeRun(low, low+remaining)
		if cur < minRun {
			forced := min(minRun, remaining)
			s.binaryInsertionSort(low, low+cur, low+forced)
			cur = forced
		}
		s.runs = append(s.runs, run{low, cur})
		s.mergeCollapse()
		low += cur
		remaining -= cur
	}
	s.mergeForceCollapse()
}

func (s *timSort[T]) countAndMakeRun(lowArg, high int) int {
	low := lowArg + 1
	if low == high {
		return 1
	}
	runLength := 2
	elementLow, elementLowPre := s.a[low], s.a[low-1]
	descending := s.compare(elementLow, elementLowPre) < 0
	prev := elementLow
	for idx := low + 1; idx < high; idx++ {
		cur := s.a[idx]
		order := s.compare(cur, prev)
		if descending {
			if order >= 0 {
				break
			}
		} else if order < 0 {
			break
		}
		prev = cur
		runLength++
	}
	if descending {
		for i, j := lowArg, lowArg+runLength-1; i < j; i, j = i+1, j-1 {
			s.a[i], s.a[j] = s.a[j], s.a[i]
		}
	}
	return runLength
}

func (s *timSort[T]) binaryInsertionSort(low, startArg, high int) {
	start := startArg
	if low == startArg {
		start++
	}
	for ; start < high; start++ {
		left, right := low, start
		pivot := s.a[start]
		for left < right {
			mid := left + ((right - left) >> 1)
			if s.compare(pivot, s.a[mid]) < 0 {
				right = mid
			} else {
				left = mid + 1
			}
		}
		for p := start; p > left; p-- {
			s.a[p] = s.a[p-1]
		}
		s.a[left] = pivot
	}
}

func (s *timSort[T]) invariant(n int) bool {
	if n < 2 {
		return true
	}
	return s.runs[n-2].length > s.runs[n-1].length+s.runs[n].length
}

func (s *timSort[T]) mergeCollapse() {
	for len(s.runs) > 1 {
		n := len(s.runs) - 2
		switch {
		case !s.invariant(n+1) || !s.invariant(n):
			if n > 0 && s.runs[n-1].length < s.runs[n+1].length {
				n--
			}
			s.mergeAt(n)
		case s.runs[n].length <= s.runs[n+1].length:
			s.mergeAt(n)
		default:
			return
		}
	}
}

func (s *timSort[T]) mergeForceCollapse() {
	for len(s.runs) > 1 {
		n := len(s.runs) - 2
		if n > 0 && s.runs[n-1].length < s.runs[n+1].length {
			n--
		}
		s.mergeAt(n)
	}
}

func (s *timSort[T]) mergeAt(i int) {
	baseA, lengthA := s.runs[i].base, s.runs[i].length
	baseB, lengthB := s.runs[i+1].base, s.runs[i+1].length
	s.runs[i].length = lengthA + lengthB
	if i == len(s.runs)-3 {
		s.runs[i+1] = s.runs[i+2]
	}
	s.runs = s.runs[:len(s.runs)-1]

	k := s.gallopRight(s.a, s.a[baseB], baseA, lengthA, 0)
	baseA += k
	lengthA -= k
	if lengthA == 0 {
		return
	}
	lengthB = s.gallopLeft(s.a, s.a[baseA+lengthA-1], baseB, lengthB, lengthB-1)
	if lengthB == 0 {
		return
	}
	if lengthA <= lengthB {
		s.mergeLow(baseA, lengthA, baseB, lengthB)
	} else {
		s.mergeHigh(baseA, lengthA, baseB, lengthB)
	}
}

func (s *timSort[T]) gallopLeft(arr []T, key T, base, length, hint int) int {
	lastOfs, offset := 0, 1
	if s.compare(arr[base+hint], key) < 0 {
		maxOfs := length - hint
		for offset < maxOfs {
			if s.compare(arr[base+hint+offset], key) >= 0 {
				break
			}
			lastOfs = offset
			offset = (offset << 1) + 1
			if offset <= 0 {
				offset = maxOfs
			}
		}
		if offset > maxOfs {
			offset = maxOfs
		}
		lastOfs += hint
		offset += hint
	} else {
		maxOfs := hint + 1
		for offset < maxOfs {
			if s.compare(arr[base+hint-offset], key) < 0 {
				break
			}
			lastOfs = offset
			offset = (offset << 1) + 1
			if offset <= 0 {
				offset = maxOfs
			}
		}
		if offset > maxOfs {
			offset = maxOfs
		}
		lastOfs, offset = hint-offset, hint-lastOfs
	}
	lastOfs++
	for lastOfs < offset {
		m := lastOfs + ((offset - lastOfs) >> 1)
		if s.compare(arr[base+m], key) < 0 {
			lastOfs = m + 1
		} else {
			offset = m
		}
	}
	return offset
}

func (s *timSort[T]) gallopRight(arr []T, key T, base, length, hint int) int {
	lastOfs, offset := 0, 1
	if s.compare(key, arr[base+hint]) < 0 {
		maxOfs := hint + 1
		for offset < maxOfs {
			if s.compare(key, arr[base+hint-offset]) >= 0 {
				break
			}
			lastOfs = offset
			offset = (offset << 1) + 1
			if offset <= 0 {
				offset = maxOfs
			}
		}
		if offset > maxOfs {
			offset = maxOfs
		}
		lastOfs, offset = hint-offset, hint-lastOfs
	} else {
		maxOfs := length - hint
		for offset < maxOfs {
			if s.compare(key, arr[base+hint+offset]) < 0 {
				break
			}
			lastOfs = offset
			offset = (offset << 1) + 1
			if offset <= 0 {
				offset = maxOfs
			}
		}
		if offset > maxOfs {
			offset = maxOfs
		}
		lastOfs += hint
		offset += hint
	}
	lastOfs++
	for lastOfs < offset {
		m := lastOfs + ((offset - lastOfs) >> 1)
		if s.compare(key, arr[base+m]) < 0 {
			offset = m
		} else {
			lastOfs = m + 1
		}
	}
	return offset
}

func (s *timSort[T]) mergeLow(baseA, lengthA, baseB, lengthB int) {
	a := s.a
	temp := append([]T(nil), a[baseA:baseA+lengthA]...)
	dest, cursorTemp, cursorB := baseA, 0, baseB
	a[dest] = a[cursorB]
	dest++
	cursorB++

	succeed := func() {
		if lengthA > 0 {
			copy(a[dest:], temp[cursorTemp:cursorTemp+lengthA])
		}
	}
	copyB := func() {
		copy(a[dest:], a[cursorB:cursorB+lengthB])
		a[dest+lengthB] = temp[cursorTemp]
	}

	lengthB--
	if lengthB == 0 {
		succeed()
		return
	}
	if lengthA == 1 {
		copyB()
		return
	}
	minGallop := s.minGallop
	for {
		winsA, winsB := 0, 0
		for {
			if s.compare(a[cursorB], temp[cursorTemp]) < 0 {
				a[dest] = a[cursorB]
				dest++
				cursorB++
				winsB++
				lengthB--
				winsA = 0
				if lengthB == 0 {
					succeed()
					return
				}
				if winsB >= minGallop {
					break
				}
			} else {
				a[dest] = temp[cursorTemp]
				dest++
				cursorTemp++
				winsA++
				lengthA--
				winsB = 0
				if lengthA == 1 {
					copyB()
					return
				}
				if winsA >= minGallop {
					break
				}
			}
		}
		minGallop++
		first := true
		for winsA >= minGallopWins || winsB >= minGallopWins || first {
			first = false
			minGallop = max(1, minGallop-1)
			s.minGallop = minGallop

			winsA = s.gallopRight(temp, a[cursorB], cursorTemp, lengthA, 0)
			if winsA > 0 {
				copy(a[dest:], temp[cursorTemp:cursorTemp+winsA])
				dest += winsA
				cursorTemp += winsA
				lengthA -= winsA
				if lengthA == 1 {
					copyB()
					return
				}
				if lengthA == 0 {
					succeed()
					return
				}
			}
			a[dest] = a[cursorB]
			dest++
			cursorB++
			lengthB--
			if lengthB == 0 {
				succeed()
				return
			}

			winsB = s.gallopLeft(a, temp[cursorTemp], cursorB, lengthB, 0)
			if winsB > 0 {
				copy(a[dest:], a[cursorB:cursorB+winsB])
				dest += winsB
				cursorB += winsB
				lengthB -= winsB
				if lengthB == 0 {
					succeed()
					return
				}
			}
			a[dest] = temp[cursorTemp]
			dest++
			cursorTemp++
			lengthA--
			if lengthA == 1 {
				copyB()
				return
			}
		}
		minGallop++
		s.minGallop = minGallop
	}
}

func (s *timSort[T]) mergeHigh(baseA, lengthA, baseB, lengthB int) {
	a := s.a
	temp := append([]T(nil), a[baseB:baseB+lengthB]...)
	dest := baseB + lengthB - 1
	cursorTemp := lengthB - 1
	cursorA := baseA + lengthA - 1
	a[dest] = a[cursorA]
	dest--
	cursorA--

	succeed := func() {
		if lengthB > 0 {
			copy(a[dest-(lengthB-1):], temp[:lengthB])
		}
	}
	copyA := func() {
		dest -= lengthA
		cursorA -= lengthA
		copy(a[dest+1:], a[cursorA+1:cursorA+1+lengthA])
		a[dest] = temp[cursorTemp]
	}

	lengthA--
	if lengthA == 0 {
		succeed()
		return
	}
	if lengthB == 1 {
		copyA()
		return
	}
	minGallop := s.minGallop
	for {
		winsA, winsB := 0, 0
		for {
			if s.compare(temp[cursorTemp], a[cursorA]) < 0 {
				a[dest] = a[cursorA]
				dest--
				cursorA--
				winsA++
				lengthA--
				winsB = 0
				if lengthA == 0 {
					succeed()
					return
				}
				if winsA >= minGallop {
					break
				}
			} else {
				a[dest] = temp[cursorTemp]
				dest--
				cursorTemp--
				winsB++
				lengthB--
				winsA = 0
				if lengthB == 1 {
					copyA()
					return
				}
				if winsB >= minGallop {
					break
				}
			}
		}
		minGallop++
		first := true
		for winsA >= minGallopWins || winsB >= minGallopWins || first {
			first = false
			minGallop = max(1, minGallop-1)
			s.minGallop = minGallop

			k := s.gallopRight(a, temp[cursorTemp], baseA, lengthA, lengthA-1)
			winsA = lengthA - k
			if winsA > 0 {
				dest -= winsA
				cursorA -= winsA
				copy(a[dest+1:], a[cursorA+1:cursorA+1+winsA])
				lengthA -= winsA
				if lengthA == 0 {
					succeed()
					return
				}
			}
			a[dest] = temp[cursorTemp]
			dest--
			cursorTemp--
			lengthB--
			if lengthB == 1 {
				copyA()
				return
			}

			k = s.gallopLeft(temp, a[cursorA], 0, lengthB, lengthB-1)
			winsB = lengthB - k
			if winsB > 0 {
				dest -= winsB
				cursorTemp -= winsB
				copy(a[dest+1:], temp[cursorTemp+1:cursorTemp+1+winsB])
				lengthB -= winsB
				if lengthB == 1 {
					copyA()
					return
				}
				if lengthB == 0 {
					succeed()
					return
				}
			}
			a[dest] = a[cursorA]
			dest--
			cursorA--
			lengthA--
			if lengthA == 0 {
				succeed()
				return
			}
		}
		minGallop++
		s.minGallop = minGallop
	}
}

// objectPrototype lists Object.prototype's own data properties: reading one
// of these keys on a plain object yields the inherited function.
var objectPrototype = map[string]string{
	"constructor": "Object", "__defineGetter__": "__defineGetter__", "__defineSetter__": "__defineSetter__",
	"hasOwnProperty": "hasOwnProperty", "__lookupGetter__": "__lookupGetter__", "__lookupSetter__": "__lookupSetter__",
	"isPrototypeOf": "isPrototypeOf", "propertyIsEnumerable": "propertyIsEnumerable", "toString": "toString",
	"valueOf": "valueOf", "toLocaleString": "toLocaleString",
}

// Tally is a plain JS object used as `obj[k] = (obj[k] ?? 0) + 1` (or
// `|| 0`): "__proto__" never becomes a key, and keys that name an
// Object.prototype method start from that function, so their value turns
// into a string ("function toString() { [native code] }1").
type Tally struct {
	keys []string
	vals map[string]any
}

// NewTally returns an empty tally.
func NewTally() *Tally { return &Tally{vals: map[string]any{}} }

// Inc adds one to key.
func (t *Tally) Inc(key string) {
	if key == "__proto__" {
		return
	}
	v, own := t.vals[key]
	if !own {
		t.keys = append(t.keys, key)
		if fn, inherited := objectPrototype[key]; inherited {
			t.vals[key] = "function " + fn + "() { [native code] }1"
			return
		}
		t.vals[key] = 1.0
		return
	}
	switch x := v.(type) {
	case float64:
		t.vals[key] = x + 1
	case string:
		t.vals[key] = x + "1"
	}
}

// Entry is one [key, value] pair of Object.entries.
type Entry struct {
	Key string
	Val any // float64, or string for the inherited-name case
}

// Entries is Object.entries(tally).
func (t *Tally) Entries() []Entry {
	keys := OwnKeys(t.keys)
	out := make([]Entry, len(keys))
	for i, k := range keys {
		out[i] = Entry{k, t.vals[k]}
	}
	return out
}

// Minus is `a - b` for tally values: anything but two numbers is NaN.
func Minus(a, b any) float64 {
	x, ok1 := a.(float64)
	y, ok2 := b.(float64)
	if !ok1 || !ok2 {
		return math.NaN()
	}
	return x - y
}

// ByCountDesc sorts entries with `(a, b) => b[1] - a[1]`.
func ByCountDesc(entries []Entry) {
	SortJS(entries, func(a, b Entry) float64 { return Minus(b.Val, a.Val) })
}
