package preventives

// Window lengths from src/services/preventives/metrics.ts.
const (
	BaselineDays     = 28
	RampUpDays       = 14
	EvalDays         = 28
	ExtendedEvalDays = 84
)

// Windows is resolvePlanWindows's result.
type Windows struct {
	BaselineFrom string `json:"baselineFrom"`
	BaselineTo   string `json:"baselineTo"`
	EvalFrom     string `json:"evalFrom"`
	EvalTo       string `json:"evalTo"`
	EvalLongTo   string `json:"evalLongTo"`
	EvalEnd      string `json:"evalEnd"`
	EvalLongEnd  string `json:"evalLongEnd"`
	HasEvalData  bool   `json:"hasEvalData"`
}

func addDays(date string, days int) string { return ymd(civil(date).AddDate(0, 0, days)) }

// ResolvePlanWindows is resolvePlanWindows for valid dates.
func ResolvePlanWindows(startDate, todayLocalDate string) Windows {
	w := Windows{
		BaselineFrom: addDays(startDate, -BaselineDays),
		BaselineTo:   addDays(startDate, -1),
		EvalFrom:     addDays(startDate, RampUpDays),
	}
	w.EvalTo = addDays(w.EvalFrom, EvalDays-1)
	w.EvalLongTo = addDays(w.EvalFrom, ExtendedEvalDays-1)
	w.EvalEnd = min(todayLocalDate, w.EvalTo)
	w.EvalLongEnd = min(todayLocalDate, w.EvalLongTo)
	w.HasEvalData = w.EvalEnd >= w.EvalFrom
	return w
}
