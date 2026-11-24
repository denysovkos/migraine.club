package jsx

import "math"

// Log and Exp are V8's Math.log / Math.exp: ports of fdlibm's
// __ieee754_log and __ieee754_exp as in v8/src/base/ieee754.cc. Go's
// math.Log and math.Exp round differently in the last bit, which statistics
// computed in Node (p-values, scores) would expose.

func hi(x float64) int32  { return int32(math.Float64bits(x) >> 32) }
func lo(x float64) uint32 { return uint32(math.Float64bits(x)) }
func withHi(x float64, h int32) float64 {
	return math.Float64frombits(uint64(uint32(h))<<32 | uint64(lo(x)))
}

// Log is Math.log.
func Log(x float64) float64 {
	const (
		ln2Hi = 6.93147180369123816490e-01
		ln2Lo = 1.90821492927058770002e-10
		two54 = 1.80143985094819840000e+16
		lg1   = 6.666666666666735130e-01
		lg2   = 3.999999999940941908e-01
		lg3   = 2.857142874366239149e-01
		lg4   = 2.222219843214978396e-01
		lg5   = 1.818357216161805012e-01
		lg6   = 1.531383769920937332e-01
		lg7   = 1.479819860511658591e-01
	)
	hx, lx := hi(x), lo(x)
	k := int32(0)
	if hx < 0x00100000 {
		if (hx&0x7fffffff)|int32(lx) == 0 {
			return math.Inf(-1)
		}
		if hx < 0 {
			return math.NaN()
		}
		k -= 54
		x *= two54
		hx = hi(x)
	}
	if hx >= 0x7ff00000 {
		return x + x
	}
	k += (hx >> 20) - 1023
	hx &= 0x000fffff
	i := (hx + 0x95f64) & 0x100000
	x = withHi(x, hx|(i^0x3ff00000))
	k += i >> 20
	f := x - 1.0
	if (0x000fffff & (2 + hx)) < 3 {
		if f == 0 {
			if k == 0 {
				return 0
			}
			dk := float64(k)
			return float64(dk*ln2Hi) + float64(dk*ln2Lo)
		}
		R := float64(float64(f*f) * float64(0.5-float64(0.33333333333333333*f)))
		if k == 0 {
			return f - R
		}
		dk := float64(k)
		return float64(dk*ln2Hi) - ((R - float64(dk*ln2Lo)) - f)
	}
	s := f / (2.0 + f)
	dk := float64(k)
	z := float64(s * s)
	i = hx - 0x6147a
	w := float64(z * z)
	j := 0x6b851 - hx
	t1 := float64(w * float64(lg2+float64(w*float64(lg4+float64(w*lg6)))))
	t2 := float64(z * float64(lg1+float64(w*float64(lg3+float64(w*float64(lg5+float64(w*lg7)))))))
	i |= j
	R := t2 + t1
	if i > 0 {
		hfsq := float64(float64(0.5*f) * f)
		if k == 0 {
			return f - (hfsq - float64(s*(hfsq+R)))
		}
		return float64(dk*ln2Hi) - ((hfsq - (float64(s*(hfsq+R)) + float64(dk*ln2Lo))) - f)
	}
	if k == 0 {
		return f - float64(s*(f-R))
	}
	return float64(dk*ln2Hi) - ((float64(s*(f-R)) - float64(dk*ln2Lo)) - f)
}

// Exp is Math.exp.
func Exp(x float64) float64 {
	const (
		huge       = 1.0e+300
		twom1000   = 9.33263618503218878990e-302
		oThreshold = 7.09782712893383973096e+02
		uThreshold = -7.45133219101941108420e+02
		invln2     = 1.44269504088896338700e+00
		p1         = 1.66666666666666019037e-01
		p2         = -2.77777777770155933842e-03
		p3         = 6.61375632143793436117e-05
		p4         = -1.65339022054652515390e-06
		p5         = 4.13813679705723846039e-08
		e          = 2.718281828459045
		two1023    = 8.988465674311579539e307
	)
	ln2HI := [2]float64{6.93147180369123816490e-01, -6.93147180369123816490e-01}
	ln2LO := [2]float64{1.90821492927058770002e-10, -1.90821492927058770002e-10}
	halF := [2]float64{0.5, -0.5}

	var hiV, loV float64
	k := int32(0)
	hx := uint32(hi(x))
	xsb := (hx >> 31) & 1
	hx &= 0x7fffffff
	if hx >= 0x40862E42 {
		if hx >= 0x7ff00000 {
			if (hx&0xfffff)|lo(x) != 0 {
				return x + x
			}
			if xsb == 0 {
				return x
			}
			return 0
		}
		if x > oThreshold {
			return math.Inf(1)
		}
		if x < uThreshold {
			return 0
		}
	}
	switch {
	case hx > 0x3fd62e42:
		if hx < 0x3FF0A2B2 {
			if x == 1.0 {
				return e
			}
			hiV = x - ln2HI[xsb]
			loV = ln2LO[xsb]
			k = 1 - int32(xsb) - int32(xsb)
		} else {
			k = int32(float64(invln2*x) + halF[xsb])
			t := float64(k)
			hiV = x - float64(t*ln2HI[0])
			loV = float64(t * ln2LO[0])
		}
		x = hiV - loV
	case hx < 0x3e300000:
		if huge+x > 1 {
			return 1 + x
		}
	default:
		k = 0
	}
	t := float64(x * x)
	var twopk float64
	if k >= -1021 {
		twopk = math.Float64frombits(uint64(0x3ff+int64(k)) << 52)
	} else {
		twopk = math.Float64frombits(uint64(0x3ff+int64(k)+1000) << 52)
	}
	c := x - float64(t*float64(p1+float64(t*float64(p2+float64(t*float64(p3+float64(t*float64(p4+float64(t*p5)))))))))
	if k == 0 {
		return 1 - (float64(x*c)/(c-2.0) - x)
	}
	y := 1 - ((loV - float64(x*c)/(2.0-c)) - hiV)
	if k >= -1021 {
		if k == 1024 {
			return float64(float64(y*2.0) * two1023)
		}
		return float64(y * twopk)
	}
	return float64(float64(y*twopk) * twom1000)
}
