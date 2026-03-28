package keyboardtutor

import "embed"

//go:embed all:public
var PublicFS embed.FS

//go:embed all:songs
var SongsFS embed.FS
