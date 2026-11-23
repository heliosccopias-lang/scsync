import sys, os
sys.path.insert(0, "/tmp/logo")
from mark import mark
from word import text_path
B="/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
M="/usr/share/fonts/truetype/google-fonts/Poppins-SemiBold.ttf" if os.path.exists("/usr/share/fonts/truetype/google-fonts/Poppins-SemiBold.ttf") else "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf"
INK="#2b2a28"; OR="#e8834a"; WHITE="#ffffff"

def wordmark(x, baseline, size, sc_color, sync_color):
    p1, x1 = text_path(B, "SC", size, x, baseline, tracking=-size*0.01)
    p2, x2 = text_path(M, "sync", size, x1 + size*0.02, baseline, tracking=-size*0.005)
    return f'<path d="{p1}" fill="{sc_color}"/><path d="{p2}" fill="{sync_color}"/>', x2

def svg(w, h, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'

def g(scale, tx, ty, inner):
    return f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})">{inner}</g>'

out={}
# Symbol (favicon, app icon) — transparent; the interlock cut needs a background, so two variants
out["scsync-mark.svg"]=svg(64,64, mark(INK, OR, bg="#ffffff"), "SCsync")
out["scsync-mark-dark.svg"]=svg(64,64, mark(WHITE, OR, bg=INK), "SCsync")
# App icon / favicon with its own background (works on any tab colour)
out["scsync-icon.svg"]=svg(64,64, f'<rect width="64" height="64" rx="14" fill="{INK}"/>'+g(0.86,4.5,4.5, mark(WHITE, OR, bg=INK)), "SCsync")

def horizontal(sc, syncc, scolor, bg, title):
    wm, xend = wordmark(54, 43, 31, sc, syncc)
    body=(f'<rect width="{xend+6:.0f}" height="64" fill="{bg}"/>' if bg!="none" else "")+g(0.8,-2,6.4, mark(scolor, OR if syncc!="#000000" else "#000000", bg=(bg if bg!="none" else "#ffffff")))+wm
    return svg(xend+6, 64, body, title)
out["scsync-horizontal.svg"]=horizontal(INK, OR, INK, "none", "SCsync")
out["scsync-horizontal-dark.svg"]=horizontal(WHITE, OR, WHITE, "none", "SCsync")

def stacked(sc, syncc, scolor, ocolor, bg, title):
    wm, xend = wordmark(0, 0, 50, sc, syncc)
    W=xend+40; scale=2.55; mw=64*scale
    body=(f'<rect width="{W:.0f}" height="232" fill="{bg}"/>' if bg!="none" else "")
    body+=g(scale,(W-mw)/2+4,-6, mark(scolor, ocolor, bg=(bg if bg!="none" else "#ffffff")))
    body+=f'<g transform="translate({(W-xend)/2:.2f} 0)">{wordmark(0, 212, 50, sc, syncc)[0]}</g>'
    return svg(W, 232, body, title)
out["scsync-logo.svg"]=stacked(INK, OR, INK, OR, "none", "SCsync")
out["scsync-logo-dark.svg"]=stacked(WHITE, OR, WHITE, OR, "none", "SCsync")
out["scsync-logo-mono.svg"]=stacked("#000000", "#000000", "#000000", "#000000", "none", "SCsync")
# Black only, for receipts and OS printed in black and white
mono_wm, xend = wordmark(54, 43, 31, "#000000", "#000000")
out["scsync-mono.svg"]=svg(xend+6, 64, g(0.8,-2,6.4, mark("#000000", "#000000", bg="#ffffff"))+mono_wm, "SCsync")
os.makedirs("/tmp/logo/out", exist_ok=True)
for k,v in out.items(): open(f"/tmp/logo/out/{k}","w").write(v)
print(list(out))
