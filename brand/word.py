from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
def text_path(font_file, text, size, x0=0, baseline=0, tracking=0):
    f=TTFont(font_file); gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f['head'].unitsPerEm
    sc=size/upm; x=x0; out=[]
    for ch in text:
        g=cmap[ord(ch)]
        pen=SVGPathPen(gs)
        tp=TransformPen(pen,(sc,0,0,-sc,x,baseline))
        gs[g].draw(tp)
        out.append(pen.getCommands())
        x+=gs[g].width*sc+tracking
    return " ".join(out), x
