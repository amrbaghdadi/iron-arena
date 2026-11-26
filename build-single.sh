#!/bin/sh
# Rebuilds play.html (single file, opens by double-click). Needs node: npx esbuild
npx -y esbuild js/main.js --bundle --format=esm --external:three '--external:three/addons/*' --minify --outfile=/tmp/ia-bundle.js
python3 - <<'PY'
import re
h=open('index.html').read(); css=open('css/style.css').read(); js=open('/tmp/ia-bundle.js').read().replace('</script','<\\/script')
h=h.replace('<link rel="stylesheet" href="css/style.css">','<style>'+css+'</style>')
h=h.replace('<script type="module" src="js/main.js"></script>','<script type="module">'+js+'</script>')
open('play.html','w').write(h)
PY
