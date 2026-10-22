"""Render the existing 译 wordmark and code-native store artwork; no external images."""
from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = next((p for p in [os.environ.get('TMP_CJK_FONT'), '/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'] if p and Path(p).exists()), None)
if not FONT:
    raise SystemExit('Set TMP_CJK_FONT to an installed CJK font to regenerate artwork.')
S = 3
GREEN, CREAM, GOLD = '#285442', '#fffdf1', '#f4cc75'
def canvas(w, h, color):
    return Image.new('RGBA', (w*S, h*S), color)
def font(size):
    return ImageFont.truetype(FONT, round(size*S))
def rounded(d, box, radius, fill, outline=None, width=1):
    d.rounded_rectangle(tuple(round(v*S) for v in box), radius=round(radius*S), fill=fill, outline=outline, width=round(width*S))
def text(d, xy, value, size, fill, anchor=None):
    d.text(tuple(round(v*S) for v in xy), value, font=font(size), fill=fill, anchor=anchor)
def save(im, path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.resize(size, Image.Resampling.LANCZOS).save(path)
def pet(d, x, y, scale=1):
    def box(a,b,c,e): return ((x+a*scale)*S,(y+b*scale)*S,(x+c*scale)*S,(y+e*scale)*S)
    d.ellipse(box(0,24,66,90), fill='#e9f2d6', outline='#355b43', width=round(2*scale*S))
    for ex in (18,42):
        d.ellipse(box(ex,45,ex+7,55), fill='#355b43')
    for ex in (10,48):
        d.ellipse(box(ex,58,ex+9,63), fill='#edb7a4')
    d.arc(box(27,53,39,67),0,180,fill='#355b43',width=round(2*scale*S))
    d.ellipse(box(23,1,43,23),fill=GOLD,outline='#d2a548',width=round(1.5*scale*S))
    d.line([(round((x+28*scale)*S),round((y+22*scale)*S)),(round((x+38*scale)*S),round((y+22*scale)*S))],fill='#d2a548',width=round(3*scale*S))
    for ex in (14,42):
        d.ellipse(box(ex,86,ex+13,93),fill='#d6e5bf',outline='#355b43',width=round(1.5*scale*S))

master=canvas(128,128,(0,0,0,0)); d=ImageDraw.Draw(master)
rounded(d,(12,12,116,116),27,GREEN)
glyph='译'; f=font(70); bbox=d.textbbox((0,0),glyph,font=f)
d.text(((128*S-(bbox[2]-bbox[0]))/2-bbox[0],(128*S-(bbox[3]-bbox[1]))/2-bbox[1]-S),glyph,font=f,fill=CREAM)
for size in (16,32,48,128): save(master,ROOT/f'assets/icons/icon-{size}.png',(size,size))

small=canvas(440,280,GREEN); d=ImageDraw.Draw(small)
text(d,(28,23),'TranslateMyPage',17,CREAM)
text(d,(28,54),'AI 网页翻译',34,CREAM)
text(d,(29,101),'沉浸式双语阅读',20,CREAM)
text(d,(29,133),'可使用 ChatGPT 订阅额度',12,'#c7d9bc')
rounded(d,(29,155,187,246),9,'#e5ecd6'); text(d,(44,168),'A',30,GREEN)
for y,w in [(212,110),(225,83)]: rounded(d,(44,y,44+w,y+4),2,'#a1b698')
text(d,(201,189),'→',26,GOLD)
rounded(d,(240,155,398,246),9,CREAM); text(d,(255,168),'文',27,GREEN)
for y,w in [(212,109),(225,76)]: rounded(d,(255,y,255+w,y+4),2,'#a1b698')
pet(d,354,165,.66)
save(small,ROOT/'store/assets/promo-small-440x280.png',(440,280))

wide=canvas(1400,560,GREEN); d=ImageDraw.Draw(wide)
text(d,(76,55),'TranslateMyPage',29,CREAM)
text(d,(76,133),'AI 网页翻译',64,CREAM)
text(d,(76,226),'沉浸式双语阅读',57,CREAM)
text(d,(80,336),'保留排版 · 划词即译',25,'#ccdfc0')
text(d,(80,389),'可使用自己已授权的 ChatGPT 订阅额度',22,'#ccdfc0')
text(d,(80,461),'免费开源  /  需安装 macOS 或 Linux 本地助手',18,'#ccdfc0')
rounded(d,(835,89,1290,259),16,'#dde7ce')
text(d,(869,115),'Read beyond borders.',27,GREEN)
for y,w in [(175,359),(195,302),(215,334)]: rounded(d,(869,y,869+w,y+7),3,'#a7bc9c')
rounded(d,(870,286,1325,456),16,CREAM)
text(d,(904,313),'让好想法，跨越语言。',27,GREEN)
for y,w in [(373,345),(393,280),(413,317)]: rounded(d,(904,y,904+w,y+7),3,'#acc29e')
pet(d,1180,363,1.45)
save(wide,ROOT/'store/assets/promo-marquee-1400x560.png',(1400,560))
print('Generated four extension icons and two promotional tiles.')
