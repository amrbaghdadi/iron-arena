#!/bin/sh
# Rebuilds play.html (single file, opens by double-click). Needs node: npx esbuild
rm -rf /tmp/ia-src && mkdir -p /tmp/ia-src && cp -r js /tmp/ia-src/js && sed -i -E "s#\?v=[0-9]+'#'#" /tmp/ia-src/js/*.js
npx -y esbuild /tmp/ia-src/js/main.js --bundle --format=esm --external:three '--external:three/addons/*' --minify --outfile=/tmp/ia-bundle.js
python3 - <<'PY'
h=open('index.html').read(); css=open('css/style.css').read(); js=open('/tmp/ia-bundle.js').read().replace('</script','<\\/script')
h=h.replace('<link rel="stylesheet" href="css/style.css?v=3">','<style>'+css+'</style>')
h=h.replace('<script type="module" src="js/main.js?v=3"></script>','<script type="module">'+js+'</script>')
open('play.html','w').write(h)
PY
