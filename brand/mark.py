import re
import math
def pt(cx,cy,r,deg): a=math.radians(deg); return (cx+r*math.cos(a), cy+r*math.sin(a))
def arrow(cx,cy,r,start,end,sweep,w,head):
    s=pt(cx,cy,r,start); e=pt(cx,cy,r,end)
    span=abs(end-start); large=1 if span>180 else 0
    a=math.radians(end)
    t=(-math.sin(a),math.cos(a)) if sweep==1 else (math.sin(a),-math.cos(a))
    n=(math.cos(a),math.sin(a))
    # shorten arc so the head sits on its end
    tip=(e[0]+t[0]*head*0.9, e[1]+t[1]*head*0.9)
    c1=(e[0]+n[0]*head*0.75 - t[0]*head*0.25, e[1]+n[1]*head*0.75 - t[1]*head*0.25)
    c2=(e[0]-n[0]*head*0.75 - t[0]*head*0.25, e[1]-n[1]*head*0.75 - t[1]*head*0.25)
    f=lambda p:f"{p[0]:.2f} {p[1]:.2f}"
    return (f'<path d="M{f(s)} A{r} {r} 0 {large} {sweep} {f(e)}" fill="none" stroke="ORANGE" stroke-width="{w}" stroke-linecap="butt"/>'
            f'<path d="M{f(tip)} L{f(c1)} L{f(c2)} Z" fill="ORANGE"/>')
_n = 0
def mark(s_color="#2b2a28", orange="#e8834a", bg=None):
    cx,cy,r,w,head=44.5,32,12.5,6.2,7.2
    up=arrow(cx,cy,r,192,318,1,w,head)
    lo=arrow(cx,cy,r,168,42,0,w,head)
    S=f'<path d="M28.5 19.5 C25.5 14.2 10.5 13.8 10.5 22.3 C10.5 30.8 28.5 28.4 28.5 37.8 C28.5 47.4 12.2 48.3 8 42.2" fill="none" stroke="{s_color}" stroke-width="8.4" stroke-linecap="round" stroke-linejoin="round"/>'
    # The C cuts a real gap into the S (transparent), so the symbol works on any background.
    global _n
    _n += 1
    mid = f"scsync-cut-{_n}"
    arcs = ''.join(p.replace('stroke="ORANGE"', 'stroke="#000"').replace('stroke-width="6.2"', 'stroke-width="10"') for p in re.findall(r'<path d="M[^"]+ A[^>]+/>', up+lo))
    S = (f'<defs><mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
         f'<rect width="64" height="64" fill="#fff"/>{arcs}</mask></defs>') + S.replace('<path ', f'<path mask="url(#{mid})" ', 1)
    cut = ""
    o1, o2 = orange if isinstance(orange, tuple) else (orange, orange)
    return S+cut+up.replace("ORANGE",o1)+lo.replace("ORANGE",o2)
if __name__=="__main__":
    for name,bg,sc in [("light","#ffffff","#2b2a28"),("dark","#2b2a28","#ffffff")]:
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256"><rect width="64" height="64" fill="{bg}"/>{mark(sc, bg=bg)}</svg>'
        open(f"mark-{name}.svg","w").write(svg)
