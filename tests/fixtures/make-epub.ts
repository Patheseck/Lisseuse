import JSZip from 'jszip';

// PNG 1×1 valide (rouge), pour vérifier l'extraction et l'affichage des images.
export const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><style>body{color:red}</style></head>
<body>${body}</body>
</html>`;

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

async function finish(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function base(): JSZip {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  return zip;
}

/** EPUB 3 : nav.xhtml, couverture, image, lien interne, contenu malveillant à neutraliser. */
export async function makeEpub3(): Promise<Uint8Array> {
  const zip = base();
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test-epub3</dc:identifier>
    <dc:title>Le Livre de Test</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>fr</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="pic" href="images/pic%201.png" media-type="image/png"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`);
  zip.file('OEBPS/nav.xhtml', xhtml('Nav', `<nav epub:type="toc"><ol>
    <li><a href="text/ch1.xhtml">Premier chapitre</a></li>
    <li><a href="text/ch2.xhtml#debut">Deuxième chapitre</a></li>
  </ol></nav>`));
  zip.file('OEBPS/images/cover.png', PNG_1PX);
  zip.file('OEBPS/images/pic 1.png', PNG_1PX);
  zip.file('OEBPS/text/ch1.xhtml', xhtml('Ch1', `<h1 id="top">Premier chapitre</h1>
    <p>La photosynthèse est le processus par lequel les plantes produisent du glucose.</p>
    <p><img src="../images/pic%201.png" alt="Schéma"/></p>
    <p><a href="ch2.xhtml#suite">Aller à la suite</a> · <a href="https://example.org">Site externe</a></p>
    <p onclick="alert(1)" style="color:red">Paragraphe piégé</p>
    <script>window.__pwned = true</script>`));
  zip.file('OEBPS/text/ch2.xhtml', xhtml('Ch2', `<h1 id="debut">Deuxième chapitre</h1>
    ${'<p>Texte de remplissage pour pouvoir faire défiler la page assez longtemps.</p>'.repeat(60)}
    <p id="suite">Voici la suite annoncée.</p>`));
  zip.file('OEBPS/text/ch3.xhtml', xhtml('Ch3', '<h2>Annexe sans entrée de sommaire</h2><p>Fin.</p>'));
  return finish(zip);
}

/** EPUB 2 : toc.ncx, couverture déclarée par <meta name="cover">. */
export async function makeEpub2(): Promise<Uint8Array> {
  const zip = base();
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Ancien Format</dc:title>
    <dc:identifier id="id">test-epub2</dc:identifier>
    <meta name="cover" content="cov"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cov" href="cover.png" media-type="image/png"/>
    <item id="a" href="a.html" media-type="application/xhtml+xml"/>
    <item id="b" href="b.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="p1"><navLabel><text>Chapitre A</text></navLabel><content src="a.html"/></navPoint>
  <navPoint id="p2"><navLabel><text>Chapitre B</text></navLabel><content src="b.html#x"/></navPoint>
</navMap></ncx>`);
  zip.file('OEBPS/cover.png', PNG_1PX);
  // XHTML volontairement mal formé (<br> non fermé) : doit être lu malgré tout.
  zip.file('OEBPS/a.html', '<html><body><p>Texte A<br>suite</p></body></html>');
  zip.file('OEBPS/b.html', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Texte B</p></body></html>');
  return finish(zip);
}
