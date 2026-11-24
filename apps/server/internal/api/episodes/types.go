package episodes

import (
	"encoding/json"

	"github.com/denysovkos/migraine.club/internal/db/q"
)

type qEpisode = q.Episode

func jsonRaw(b []byte) json.RawMessage { return json.RawMessage(b) }
