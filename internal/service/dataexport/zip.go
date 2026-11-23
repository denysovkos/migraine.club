package dataexport

import (
	"bytes"
	"compress/flate"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"time"
)

// ZipEntry is one archive member.
type ZipEntry struct {
	Name string
	Data []byte
}

const (
	zip32Max      = 0xFFFFFFFF
	utf8Flag      = 0x0800
	methodDeflate = 8
	zipVersion    = 20
)

// ErrTooLarge is the ZIP32 overflow error.
var ErrTooLarge = errors.New("Export too large for ZIP32 archive")

// dosDateTime is toDosDateTime (UTC, years before 1980 clamp to 1980).
func dosDateTime(t time.Time) (uint16, uint16) {
	t = t.UTC()
	year := max(t.Year(), 1980)
	tm := t.Hour()<<11 | t.Minute()<<5 | t.Second()/2
	d := (year-1980)<<9 | int(t.Month())<<5 | t.Day()
	return uint16(tm), uint16(d) //nolint:gosec // DOS fields are 16-bit by definition.
}

// CreateZip is createZip: the same headers, field by field. Members are
// deflated at zlib's default level; the compressed bytes can differ from
// node:zlib's, the inflated contents and every header field besides the
// compressed size do not.
func CreateZip(entries []ZipEntry, modified time.Time) ([]byte, error) {
	tm, d := dosDateTime(modified)
	var local, central bytes.Buffer
	le := binary.LittleEndian
	offset := 0
	for _, e := range entries {
		var comp bytes.Buffer
		w, _ := flate.NewWriter(&comp, 6)
		_, _ = w.Write(e.Data)
		_ = w.Close()
		sum := crc32.ChecksumIEEE(e.Data)
		if len(e.Data) > zip32Max || comp.Len() > zip32Max || offset > zip32Max {
			return nil, ErrTooLarge
		}
		name := []byte(e.Name)

		h := make([]byte, 30)
		le.PutUint32(h[0:], 0x04034B50)
		le.PutUint16(h[4:], zipVersion)
		le.PutUint16(h[6:], utf8Flag)
		le.PutUint16(h[8:], methodDeflate)
		le.PutUint16(h[10:], tm)
		le.PutUint16(h[12:], d)
		le.PutUint32(h[14:], sum)
		le.PutUint32(h[18:], uint32(comp.Len()))  //nolint:gosec // checked above
		le.PutUint32(h[22:], uint32(len(e.Data))) //nolint:gosec // checked above
		le.PutUint16(h[26:], uint16(len(name)))   //nolint:gosec // short names
		local.Write(h)
		local.Write(name)
		local.Write(comp.Bytes())

		c := make([]byte, 46)
		le.PutUint32(c[0:], 0x02014B50)
		le.PutUint16(c[4:], zipVersion)
		le.PutUint16(c[6:], zipVersion)
		le.PutUint16(c[8:], utf8Flag)
		le.PutUint16(c[10:], methodDeflate)
		le.PutUint16(c[12:], tm)
		le.PutUint16(c[14:], d)
		le.PutUint32(c[16:], sum)
		le.PutUint32(c[20:], uint32(comp.Len()))  //nolint:gosec // checked above
		le.PutUint32(c[24:], uint32(len(e.Data))) //nolint:gosec // checked above
		le.PutUint16(c[28:], uint16(len(name)))   //nolint:gosec // short names
		le.PutUint32(c[42:], uint32(offset))      //nolint:gosec // checked above
		central.Write(c)
		central.Write(name)

		offset += 30 + len(name) + comp.Len()
	}
	if len(entries) > 0xFFFF || offset > zip32Max {
		return nil, ErrTooLarge
	}
	end := make([]byte, 22)
	le.PutUint32(end[0:], 0x06054B50)
	le.PutUint16(end[8:], uint16(len(entries)))   //nolint:gosec // checked above
	le.PutUint16(end[10:], uint16(len(entries)))  //nolint:gosec // checked above
	le.PutUint32(end[12:], uint32(central.Len())) //nolint:gosec // bounded by entries
	le.PutUint32(end[16:], uint32(offset))        //nolint:gosec // checked above
	out := append(local.Bytes(), central.Bytes()...)
	return append(out, end...), nil
}
