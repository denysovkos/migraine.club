package httpx_test

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/httpx"
)

const boundary = "testboundary0123456789abcdefghij"


func parse(t *testing.T, ct, body string) ([]httpx.FormEntry, error) {
	r := httptest.NewRequest("POST", "/", strings.NewReader(body))
	if ct != "" {
		r.Header.Set("Content-Type", ct)
	}
	return httpx.ReadFormData(r)
}

func TestParseMIMEType(t *testing.T) {
	m, ok := httpx.ParseMIMEType(` Multipart/Form-Data ; charset=utf-8; BOUNDARY="a\"b"; boundary=second`)
	require.True(t, ok)
	require.Equal(t, "multipart/form-data", m.Essence)
	require.Equal(t, `a"b`, m.Params["boundary"], "first value wins")
	require.Equal(t, "utf-8", m.Params["charset"])
	for _, bad := range []string{"", "text", "/x", "text/", "te xt/plain"} {
		_, ok := httpx.ParseMIMEType(bad)
		require.False(t, ok, bad)
	}
}

func TestReadFormData(t *testing.T) {
	ct := "multipart/form-data; boundary=" + boundary
	body := "preamble\r\n--" + boundary + "\r\n" +
		"Content-Disposition: form-data; name=\"note\"\r\n\r\nhello\r\n--" + boundary + "\r\n" +
		"content-disposition: form-data; name=\"file\"; filename=\"a%22b.PDF\"; filename*=utf-8''caf%C3%A9.pdf\r\n" +
		"Content-Type: Application/PDF \r\n\r\n%PDF\r\n--" + boundary + "\r\n" +
		"Content-Disposition: form-data; name=\"plain\"; filename=\"x\"\r\n\r\nraw\r\n--" + boundary + "--\r\nepilogue"
	entries, err := parse(t, ct, body)
	require.NoError(t, err)
	require.Len(t, entries, 3)
	require.Equal(t, "hello", entries[0].Value)
	require.Nil(t, entries[0].File)
	f := httpx.Get(entries, "file").File
	require.Equal(t, "café.pdf", f.Name, "filename* wins over filename")
	require.Equal(t, "application/pdf", f.Type, "File lowercases its type")
	require.Equal(t, "%PDF", string(f.Data))
	require.Equal(t, "text/plain", httpx.Get(entries, "plain").File.Type)
	require.Nil(t, httpx.Get(entries, "missing"))

	for _, c := range []struct{ ct, body string }{
		{"", body}, {"application/json", "{}"}, {"multipart/form-data", body},
		{ct, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\nno end"},
		{ct, "--" + boundary + "\r\nContent-Disposition: attachment; name=\"a\"\r\n\r\nx\r\n--" + boundary + "--"},
		{ct, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"a\"; filename*=utf-8''%E2%82\r\n\r\nx\r\n--" + boundary + "--"},
		{ct, "nothing"},
	} {
		_, err := parse(t, c.ct, c.body)
		require.Error(t, err, c.body)
	}
	urlencoded, err := parse(t, "application/x-www-form-urlencoded", "file=x")
	require.NoError(t, err)
	require.Nil(t, httpx.Get(urlencoded, "file"))
}

func TestReadFormDataBase64(t *testing.T) {
	ct := "multipart/form-data; boundary=" + boundary
	body := "--" + boundary + "\r\nContent-Disposition: form-data; name=\"f\"; filename=\"b\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBE\r\nRi0x=junk\r\n--" + boundary + "--"
	entries, err := parse(t, ct, body)
	require.NoError(t, err)
	require.Equal(t, "%PDF-1", string(entries[0].File.Data))
}
