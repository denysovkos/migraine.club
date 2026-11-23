// Package questionnaires is src/services/questionnaires/scoring.ts: HIT-6,
// MIDAS and MSQ v2.1 scoring.
package questionnaires

import (
	"fmt"

	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Types are QuestionnaireType's values.
var Types = []string{"HIT6", "MIDAS", "MSQ21"}

var hit6Points = map[string]float64{"NEVER": 6, "RARELY": 8, "SOMETIMES": 10, "VERY_OFTEN": 11, "ALWAYS": 13}

func questions(n int, s func() zod.Schema) *zod.ObjectSchema {
	fs := make([]zod.Field, n)
	for i := range fs {
		fs[i] = zod.F(fmt.Sprintf("q%d", i+1), s())
	}
	return zod.Object(fs...)
}

var (
	hit6Schema  = questions(6, func() zod.Schema { return zod.Enum("NEVER", "RARELY", "SOMETIMES", "VERY_OFTEN", "ALWAYS") })
	midasSchema = questions(5, func() zod.Schema { return zod.Number().Int().Min(0).Max(180) })
	msqSchema   = questions(14, func() zod.Schema { return zod.Number().Int().Min(1).Max(6) })
)

// Scored is scoreQuestionnaire's result. Details is nil for null.
type Scored struct {
	Answers any
	Total   int32
	Details any
}

// MidasGrade is midasGrade.
func MidasGrade(total float64) string {
	switch {
	case total <= 5:
		return "Grade I"
	case total <= 10:
		return "Grade II"
	case total <= 20:
		return "Grade III"
	default:
		return "Grade IV"
	}
}

// transformMsq is transformMsqScore: the 0–100 transform, one decimal.
func transformMsq(sum, items float64) float64 {
	avg := sum / items
	return jsx.Round(((avg-1)/5*100)*10) / 10
}

func sum(m map[string]any, from, to int) float64 {
	total := 0.0
	for i := from; i <= to; i++ {
		total += m[fmt.Sprintf("q%d", i)].(float64)
	}
	return total
}

// Score is scoreQuestionnaire. The error is the answers' ZodError.
func Score(kind string, answers any) (Scored, error) {
	switch kind {
	case "HIT6":
		out, err := zod.Parse(hit6Schema, answers)
		if err != nil {
			return Scored{}, err
		}
		m := out.(map[string]any)
		total := 0.0
		for i := 1; i <= 6; i++ {
			total += hit6Points[m[fmt.Sprintf("q%d", i)].(string)]
		}
		return Scored{Answers: zod.Ordered(hit6Schema, out), Total: int32(total)}, nil
	case "MIDAS":
		out, err := zod.Parse(midasSchema, answers)
		if err != nil {
			return Scored{}, err
		}
		total := sum(out.(map[string]any), 1, 5)
		return Scored{Answers: zod.Ordered(midasSchema, out), Total: int32(total),
			Details: map[string]any{"grade": MidasGrade(total)}}, nil
	default: // MSQ21
		out, err := zod.Parse(msqSchema, answers)
		if err != nil {
			return Scored{}, err
		}
		m := out.(map[string]any)
		r, p, e := sum(m, 1, 7), sum(m, 8, 11), sum(m, 12, 14)
		total := transformMsq(r+p+e, 14)
		return Scored{Answers: zod.Ordered(msqSchema, out), Total: int32(jsx.Round(total)),
			Details: zod.OrderedObject{Keys: []string{"domains"}, Values: map[string]any{"domains": zod.OrderedObject{
				Keys: []string{"restrictive", "preventive", "emotional", "total"},
				Values: map[string]any{"restrictive": transformMsq(r, 7), "preventive": transformMsq(p, 4),
					"emotional": transformMsq(e, 3), "total": total},
			}}}}, nil
	}
}
