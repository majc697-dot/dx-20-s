# -*- coding: utf-8 -*-
"""DX-20S 行车安全信息终端 — 浅色背景 PPT 生成器（python-pptx）
输出：DX-20S_行车安全信息终端.pptx
"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ---------- 颜色（浅色主题） ----------
BG        = RGBColor(0xF7, 0xF9, 0xFC)
SURFACE   = RGBColor(0xFF, 0xFF, 0xFF)
PRIMARY   = RGBColor(0x25, 0x63, 0xEB)
SECONDARY = RGBColor(0x0E, 0xA5, 0xE9)
ACCENT    = RGBColor(0xF5, 0x9E, 0x0B)
TEXT      = RGBColor(0x1E, 0x29, 0x3B)
SUBTEXT   = RGBColor(0x64, 0x74, 0x8B)
BORDER    = RGBColor(0xE2, 0xE8, 0xF0)
DARK      = RGBColor(0x0F, 0x17, 0x2A)
BEZEL     = RGBColor(0x2B, 0x34, 0x45)
ON_DARK   = RGBColor(0xE2, 0xE8, 0xF0)
ON_DARK_2 = RGBColor(0x93, 0xC5, 0xFD)
GREY_D    = RGBColor(0x94, 0xA3, 0xB8)
GREEN     = RGBColor(0x34, 0xD3, 0x99)
RED       = RGBColor(0xF8, 0x71, 0x71)
FONT      = 'Microsoft YaHei'

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
TOTAL = 13


def slide():
    s = prs.slides.add_slide(BLANK)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = BG
    return s


def shape(s, x, y, w, h, fill, line=None, line_w=None, rounded=False, radii=0.10):
    st = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    sp = s.shapes.add_shape(st, x, y, w, h)
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = line_w or Pt(1)
    if rounded:
        try:
            sp.adjustments[0] = radii
        except Exception:
            pass
    sp.shadow.inherit = False
    return sp


def text(s, x, y, w, h, paras, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         space_after=4, line_spacing=1.12):
    """paras: list of paragraphs; each paragraph = list of runs (text,size,color,bold)."""
    tb = s.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = Pt(2); tf.margin_right = Pt(2)
    tf.margin_top = Pt(1); tf.margin_bottom = Pt(1)
    for i, runs in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(space_after)
        p.line_spacing = line_spacing
        for (t, sz, col, bold) in runs:
            r = p.add_run(); r.text = t
            r.font.size = Pt(sz); r.font.color.rgb = col
            r.font.bold = bold; r.font.name = FONT
    return tb


def title(s, t):
    shape(s, Inches(0.66), Inches(0.52), Inches(0.09), Inches(0.66), PRIMARY)
    text(s, Inches(0.92), Inches(0.42), Inches(11.4), Inches(0.85),
         [[(t, 34, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)


def footer(s, n):
    text(s, Inches(0.66), Inches(6.92), Inches(8), Inches(0.4),
         [[('DX-20S 行车安全信息终端', 13, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
    text(s, Inches(11.3), Inches(6.92), Inches(1.4), Inches(0.4),
         [[(f'{n:02d} / {TOTAL}', 13, SUBTEXT, False)]],
         align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)


def badge(s, x, y, d, fill, label, label_color=SURFACE, fs=22):
    shape(s, x, y, d, d, fill, rounded=True, radii=0.28)
    text(s, x, y, d, d, [[(label, fs, label_color, True)]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def draw_signal(s, x, y, w, h):
    n = 4
    gap = Emu(int(w * 0.08))
    bw = Emu(int((w - gap * (n - 1)) / n))
    for i in range(n):
        bh = Emu(int(h * (0.35 + 0.65 * (i + 1) / n)))
        bx = x + i * (bw + gap)
        by = y + h - bh
        col = GREEN if i >= 2 else (SECONDARY if i == 1 else GREY_D)
        shape(s, bx, by, bw, bh, col)


def draw_battery(s, x, y, w, h):
    shape(s, x, y, w, h, None, line=GREY_D, line_w=Pt(1.2), rounded=True, radii=0.4)
    pad = Emu(int(w * 0.12))
    fillw = Emu(int((w - 2 * pad) * 0.7))
    fillh = Emu(int(h - 2 * pad))
    shape(s, x + pad, y + pad, fillw, fillh, GREEN, rounded=True, radii=0.3)
    nub = Emu(int(w * 0.10)); nh = Emu(int(h * 0.45))
    shape(s, x + w, y + Emu(int((h - nh) / 2)), nub, nh, GREY_D, rounded=True, radii=0.3)


def draw_device(s, x, y, w, h, msg, hide_hint=False):
    shape(s, x, y, w, h, BEZEL, rounded=True, radii=0.07)
    m = Emu(int(w * 0.07))
    sx, sy, sw, sh = x + m, y + m, w - 2 * m, h - 2 * m
    shape(s, sx, sy, sw, sh, DARK, rounded=True, radii=0.06)
    pad = Emu(int(sw * 0.07))
    ix, iy, iw, ih = sx + pad, sy + pad, sw - 2 * pad, sh - 2 * pad
    sb_h = Emu(int(ih * 0.15))
    text(s, ix, iy, Emu(int(iw * 0.5)), sb_h,
         [[(msg['time'], 11, ON_DARK_2, True)]], anchor=MSO_ANCHOR.MIDDLE)
    draw_signal(s, ix + Emu(int(iw * 0.55)), iy + Emu(int(sb_h * 0.2)),
                Emu(int(iw * 0.20)), Emu(int(sb_h * 0.6)))
    draw_battery(s, ix + Emu(int(iw * 0.78)), iy + Emu(int(sb_h * 0.15)),
                 Emu(int(iw * 0.20)), Emu(int(sb_h * 0.7)))
    cy = iy + sb_h + Emu(int(ih * 0.03))
    ch = (sy + sh - Emu(int(ih * 0.16))) - cy
    draw_message(s, ix, cy, iw, ch, msg)
    if not hide_hint:
        hy = sy + sh - Emu(int(ih * 0.15))
        text(s, ix, hy, iw, Emu(int(ih * 0.13)),
             [[('[K] 确认   [C] 返回   [X] 翻看', 10, GREY_D, False)]],
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def draw_message(s, x, y, w, h, msg):
    up = msg['dir'] == 0
    dcol = GREEN if up else RED
    dtext = '上行' if up else '下行'
    text(s, x, y, Emu(int(w * 0.62)), Emu(int(h * 0.34)),
         [[(msg['train'], 22, ON_DARK, True)]], anchor=MSO_ANCHOR.MIDDLE)
    dw = Emu(int(w * 0.32)); dh = Emu(int(h * 0.26))
    shape(s, x + w - dw, y + Emu(int(h * 0.02)), dw, dh, dcol, rounded=True, radii=0.35)
    text(s, x + w - dw, y + Emu(int(h * 0.02)), dw, dh,
         [[(dtext, 13, DARK, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    iy = y + Emu(int(h * 0.42))
    rows = [('限速', msg['speed']), ('里程', msg['km']), ('线路', msg['line'])]
    rh = Emu(int((h - h * 0.42) / 3))
    for i, (k, v) in enumerate(rows):
        ry = iy + i * rh
        text(s, x, ry, Emu(int(w * 0.28)), rh,
             [[(k, 11, GREY_D, False)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + Emu(int(w * 0.28)), ry, Emu(int(w * 0.72)), rh,
             [[(v, 13, ON_DARK, True)]], anchor=MSO_ANCHOR.MIDDLE)


def card(s, x, y, w, h, fill=SURFACE, line=BORDER, top_accent=None):
    shape(s, x, y, w, h, fill, line=line, line_w=Pt(1), rounded=True, radii=0.05)
    if top_accent is not None:
        shape(s, x, y, w, Emu(int(h * 0.10)), top_accent, rounded=False)
        # rounded top corners illusion: overlay small bg corners not needed


def sample_msg(train='G1234', d=0, speed='348', km='1234.5', line='京沪线', time='20:30'):
    return {'train': train, 'dir': d, 'speed': speed, 'km': km, 'line': line, 'time': time}


# =================== 页面构建 ===================
def p01_cover():
    s = slide()
    # 右上柔光装饰
    shape(s, Inches(9.2), Inches(-1.2), Inches(5.5), Inches(5.5), PRIMARY, rounded=True, radii=0.5)
    shape(s, Inches(10.6), Inches(2.6), Inches(4.2), Inches(4.2), SECONDARY, rounded=True, radii=0.5)
    # 左侧标题
    text(s, Inches(0.9), Inches(1.5), Inches(8.0), Inches(2.6),
         [[('DX-20S', 30, PRIMARY, True)],
          [('行车安全信息终端', 60, TEXT, True)],
          [('', 10, TEXT, False)],
          [('产品介绍与使用指南', 26, SUBTEXT, False)]],
         space_after=10, line_spacing=1.05)
    shape(s, Inches(0.92), Inches(4.5), Inches(3.2), Inches(0.05), PRIMARY)
    text(s, Inches(0.92), Inches(4.7), Inches(8.0), Inches(0.8),
         [[('面向一线操作人员的简明图解 · 版本 V2.1', 16, SUBTEXT, False)]])
    # 右侧设备
    card(s, Inches(8.5), Inches(1.3), Inches(4.0), Inches(5.2), SURFACE, line=BORDER)
    draw_device(s, Inches(8.85), Inches(1.65), Inches(3.3), Inches(4.5), sample_msg())
    footer(s, 1)


def p02_catalog():
    s = slide()
    title(s, '目录')
    text(s, Inches(0.92), Inches(1.45), Inches(11), Inches(0.6),
         [[('从认识设备到日常使用，四步带你上手这台信息终端', 18, SUBTEXT, False)]])
    items = [
        ('01', '认识设备', '它是什么，长什么样，按键怎么用', PRIMARY),
        ('02', '日常使用', '主屏幕怎么看，信息来了怎么处理', SECONDARY),
        ('03', '常用设置与保障', '个性设置、信息筛选、常见问题与保养', ACCENT),
    ]
    y = Inches(2.3)
    for num, name, desc, col in items:
        card(s, Inches(0.92), y, Inches(11.5), Inches(1.25), SURFACE, line=BORDER, top_accent=col)
        badge(s, Inches(1.2), y + Inches(0.3), Inches(0.65), col, num, SURFACE, fs=24)
        text(s, Inches(2.15), y + Inches(0.18), Inches(9.8), Inches(0.55),
             [[(name, 24, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, Inches(2.15), y + Inches(0.72), Inches(9.8), Inches(0.45),
             [[(desc, 16, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
        y += Inches(1.45)
    footer(s, 2)


def section(n, num, name, sub):
    s = slide()
    shape(s, Inches(5.4), Inches(1.9), Inches(2.5), Inches(2.5), PRIMARY, rounded=True, radii=0.5)
    text(s, Inches(5.4), Inches(1.9), Inches(2.5), Inches(2.5),
         [[(num, 64, SURFACE, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, Inches(0), Inches(4.7), Inches(13.333), Inches(1.0),
         [[(name, 44, TEXT, True)]], align=PP_ALIGN.CENTER)
    text(s, Inches(0), Inches(5.7), Inches(13.333), Inches(0.6),
         [[(sub, 18, SUBTEXT, False)]], align=PP_ALIGN.CENTER)
    footer(s, n)


def p04_what():
    s = slide()
    title(s, '它是什么')
    text(s, Inches(0.92), Inches(1.5), Inches(5.2), Inches(4.6),
         [[('一台放在驾驶室里的', 22, TEXT, False)],
          [('行车安全信息终端', 26, PRIMARY, True)],
          [('', 8, TEXT, False)],
          [('它自动接收由运指中心发来的前方安全信息，在屏幕上清晰显示，并配合声音与震动提醒您，帮您提前知道前方哪里要限速、哪里有人在作业。', 19, SUBTEXT, False)]],
         line_spacing=1.35, space_after=8)
    cards = [
        ('自动接收', '后台持续监听，重要提示主动送到眼前，无需手动操作。', PRIMARY),
        ('清晰显示', '车次、方向、速度、里程、线路一目了然，绿/红区分上下行。', SECONDARY),
        ('声音 + 震动', '可设只响、只震、又响又震或静音，夜间也不漏提醒。', ACCENT),
    ]
    x = Inches(6.5); w = Inches(5.9); hh = Inches(1.45)
    y = Inches(1.6)
    for name, desc, col in cards:
        card(s, x, y, w, hh, SURFACE, line=BORDER, top_accent=col)
        badge(s, x + Inches(0.25), y + Inches(0.45), Inches(0.55), col, '✓', SURFACE, fs=22)
        text(s, x + Inches(1.0), y + Inches(0.2), w - Inches(1.2), Inches(0.5),
             [[(name, 22, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + Inches(1.0), y + Inches(0.72), w - Inches(1.2), Inches(0.6),
             [[(desc, 15, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
        y += Inches(1.62)
    footer(s, 4)


def p05_appearance():
    s = slide()
    title(s, '外观与按键')
    card(s, Inches(0.9), Inches(1.55), Inches(4.2), Inches(5.0), SURFACE, line=BORDER)
    draw_device(s, Inches(1.25), Inches(1.9), Inches(3.5), Inches(4.3), sample_msg())
    # 右侧四键
    keys = [
        ('左键（上）', '向上选择 / 翻看上一条信息', PRIMARY),
        ('确认键（中上）', '进入菜单 / 打开一条信息', SECONDARY),
        ('右键（中下）', '返回 / 退出当前页面', ACCENT),
        ('下键（下）', '向下选择 / 翻看下一条信息', PRIMARY),
    ]
    x = Inches(5.5); w = Inches(6.9); hh = Inches(0.92)
    y = Inches(1.7)
    for name, desc, col in keys:
        card(s, x, y, w, hh, SURFACE, line=BORDER, top_accent=col)
        badge(s, x + Inches(0.22), y + Inches(0.21), Inches(0.5), col, '', SURFACE, fs=14)
        text(s, x + Inches(0.95), y + Inches(0.12), w - Inches(1.1), Inches(0.42),
             [[(name, 20, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + Inches(0.95), y + Inches(0.5), w - Inches(1.1), Inches(0.36),
             [[(desc, 15, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
        y += Inches(1.06)
    text(s, Inches(5.5), Inches(6.05), Inches(6.9), Inches(0.6),
         [[('屏幕底栏的 [K][C][X] 会提示您此刻按哪个键能做什么，跟着提示走即可。', 14, SUBTEXT, False)]])
    footer(s, 5)


def p07_screen():
    s = slide()
    title(s, '主屏幕怎么看')
    # 上方设备居中
    card(s, Inches(4.7), Inches(1.45), Inches(3.9), Inches(4.0), SURFACE, line=BORDER)
    draw_device(s, Inches(5.0), Inches(1.75), Inches(3.3), Inches(3.4), sample_msg())
    # 下方三区卡片
    zones = [
        ('顶部状态栏', '日期、时间、信号格与电量一目了然。', PRIMARY),
        ('中央信息区', '显示车次、方向（绿/红）、限速、里程、线路。', SECONDARY),
        ('底部操作栏', '[K]确认 [C]返回 [X]翻看，随时知道怎么操作。', ACCENT),
    ]
    x = Inches(0.92); w = Inches(3.78); hh = Inches(1.2)
    y = Inches(5.5)
    for name, desc, col in zones:
        card(s, x, y, w, hh, SURFACE, line=BORDER, top_accent=col)
        text(s, x + Inches(0.2), y + Inches(0.14), w - Inches(0.4), Inches(0.4),
             [[(name, 20, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + Inches(0.2), y + Inches(0.55), w - Inches(0.4), Inches(0.55),
             [[(desc, 14, SUBTEXT, False)]], anchor=MSO_ANCHOR.TOP)
        x += Inches(3.93)
    footer(s, 7)


def p08_read():
    s = slide()
    title(s, '信息来了怎么看')
    steps = [
        ('① 看方向颜色', '绿色=上行，红色=下行，一眼分清是否和本车相关。'),
        ('② 看里程位置', '确认信息生效的地点，提前规划。'),
        ('③ 看限速要求', '按提示控制好速度，留意前方作业或限速区段。'),
        ('④ 确认收到', '按需进行"已读确认"，避免重复打扰。'),
    ]
    y = Inches(1.6); w = Inches(7.4); hh = Inches(1.18)
    for name, desc in steps:
        card(s, Inches(0.92), y, w, hh, SURFACE, line=BORDER, top_accent=PRIMARY)
        text(s, Inches(1.15), y + Inches(0.16), w - Inches(0.4), Inches(0.45),
             [[(name, 21, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, Inches(1.15), y + Inches(0.6), w - Inches(0.4), Inches(0.5),
             [[(desc, 15, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
        y += Inches(1.32)
    card(s, Inches(8.7), Inches(1.6), Inches(3.7), Inches(4.7), SURFACE, line=BORDER)
    draw_device(s, Inches(9.0), Inches(1.95), Inches(3.1), Inches(4.0),
                sample_msg(train='D2001', d=1, speed='245', km='882.3', line='沪昆线'))
    footer(s, 8)


def p10_settings():
    s = slide()
    title(s, '个性设置')
    sets = [
        ('提示方式', ['只响 / 只震 / 又响又震 / 静音', '还可选择提醒时长'], PRIMARY),
        ('屏幕亮度', ['多级亮度可调', '强光调亮，夜间调暗省电'], SECONDARY),
        ('画面风格', ['多套配色主题', '挑看着最舒服的一款'], ACCENT),
        ('时间设置', ['自动保持时钟', '需要时手动校准年/月/日'], PRIMARY),
    ]
    x = Inches(0.92); w = Inches(2.86); hh = Inches(4.4)
    y = Inches(1.7)
    for name, lines, col in sets:
        card(s, x, y, w, hh, SURFACE, line=BORDER, top_accent=col)
        badge(s, x + (w - Inches(0.8)) / 2, y + Inches(0.4), Inches(0.8), col, '设', SURFACE, fs=30)
        text(s, x, y + Inches(1.4), w, Inches(0.5),
             [[(name, 22, TEXT, True)]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + Inches(0.25), y + Inches(2.05), w - Inches(0.5), Inches(2.0),
             [[('· ' + l, 15, SUBTEXT, False)] for l in lines], space_after=10, line_spacing=1.3)
        x += Inches(3.0)
    footer(s, 10)


def p11_filter():
    s = slide()
    title(s, '信息筛选与回看')
    # 左：筛选
    card(s, Inches(0.92), Inches(1.6), Inches(5.7), Inches(4.9), SURFACE, line=BORDER, top_accent=PRIMARY)
    text(s, Inches(1.2), Inches(1.85), Inches(5.2), Inches(0.5),
         [[('只看关心的', 24, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
    text(s, Inches(1.2), Inches(2.45), Inches(5.2), Inches(0.5),
         [[('设置筛选条件，让设备只重点提示与您相关的内容：', 16, SUBTEXT, False)]])
    flt = [('按运行线路', '只关注当前所在线路'),
           ('按行驶方向', '只关注上行或下行'),
           ('按信息类型', '只关注特定类别的提示')]
    y = Inches(3.1)
    for name, desc in flt:
        badge(s, Inches(1.2), y + Inches(0.05), Inches(0.5), SECONDARY, '✓', SURFACE, fs=20)
        text(s, Inches(1.9), y, Inches(4.5), Inches(0.4), [[(name, 19, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, Inches(1.9), y + Inches(0.4), Inches(4.5), Inches(0.4), [[(desc, 14, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
        y += Inches(0.95)
    # 右：回看
    card(s, Inches(6.9), Inches(1.6), Inches(5.5), Inches(4.9), SURFACE, line=BORDER, top_accent=ACCENT)
    text(s, Inches(7.2), Inches(1.85), Inches(5.0), Inches(0.5),
         [[('回看历史', 24, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
    text(s, Inches(7.2), Inches(2.45), Inches(5.0), Inches(1.2),
         [[('错过了或想再看看之前的信息，按左键进入"回看"，可一条条往前翻。屏幕会显示"回看 第几条 / 共几条"，方便追溯。', 16, SUBTEXT, False)]],
         line_spacing=1.35)
    badge(s, Inches(7.2), Inches(4.4), Inches(1.2), PRIMARY, '回', SURFACE, fs=40)
    text(s, Inches(8.6), Inches(4.5), Inches(3.6), Inches(1.0),
         [[('忘记的内容，随时回看补上', 16, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
    footer(s, 11)


def p12_faq():
    s = slide()
    title(s, '常见问题与保养')
    faqs = [
        ('一直显示"正在接收"正常吗？', '正常，说明设备在工作监听，没有新信息时也如此。'),
        ('没声音 / 没震动了？', '检查提示方式是否被设为静音，或是否处于免打扰场景。'),
        ('信息看不全 / 看不清？', '调高屏幕亮度，或在画面风格里换对比更明显的主题。'),
    ]
    y = Inches(1.6); w = Inches(7.2)
    for q, a in faqs:
        card(s, Inches(0.92), y, w, Inches(1.5), SURFACE, line=BORDER, top_accent=PRIMARY)
        text(s, Inches(1.15), y + Inches(0.18), w - Inches(0.4), Inches(0.5),
             [[('Q  ' + q, 19, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, Inches(1.15), y + Inches(0.72), w - Inches(0.4), Inches(0.6),
             [[('A  ' + a, 15, SUBTEXT, False)]], anchor=MSO_ANCHOR.MIDDLE)
        y += Inches(1.66)
    # 右侧安全保养
    card(s, Inches(8.4), Inches(1.6), Inches(4.0), Inches(4.9), RGBColor(0xFF,0xF4,0xE6), line=RGBColor(0xF5,0x9E,0x0B), top_accent=ACCENT)
    text(s, Inches(8.7), Inches(1.9), Inches(3.5), Inches(0.5),
         [[('安全与保养', 22, TEXT, True)]], anchor=MSO_ANCHOR.MIDDLE)
    tips = ['使用标配充电配件，避免来路不明电源线',
            '环境过热会自动关机保护，降温后再用',
            '勿自行拆解、撞击或进水，显示屏易碎',
            '本设备为辅助提醒，仍以现场实际为准',
            '长期不用也请定期充电']
    text(s, Inches(8.7), Inches(2.6), Inches(3.5), Inches(3.6),
         [[('· ' + t, 15, SUBTEXT, False)] for t in tips], space_after=12, line_spacing=1.3)
    footer(s, 12)


def p13_ending():
    s = slide()
    shape(s, Inches(0), Inches(0), Inches(13.333), Inches(7.5), BG)
    shape(s, Inches(-1.5), Inches(4.6), Inches(5.5), Inches(5.5), PRIMARY, rounded=True, radii=0.5)
    shape(s, Inches(10.2), Inches(-1.8), Inches(5.5), Inches(5.5), SECONDARY, rounded=True, radii=0.5)
    text(s, Inches(0), Inches(2.5), Inches(13.333), Inches(1.4),
         [[('安全，从看清每一条提示开始', 46, TEXT, True)]], align=PP_ALIGN.CENTER)
    shape(s, Inches(5.66), Inches(4.0), Inches(2.0), Inches(0.06), PRIMARY)
    text(s, Inches(0), Inches(4.3), Inches(13.333), Inches(0.8),
         [[('DX-20S 行车安全信息终端 · 愿每一次出行都平安抵达', 20, SUBTEXT, False)]],
         align=PP_ALIGN.CENTER)
    text(s, Inches(0), Inches(6.4), Inches(13.333), Inches(0.5),
         [[('感谢观看', 16, SUBTEXT, False)]], align=PP_ALIGN.CENTER)


# ---------- 组装 ----------
p01_cover()
p02_catalog()
section(3, '01', '认识设备', '它是什么，长什么样，按键怎么用')
p04_what()
p05_appearance()
section(6, '02', '日常使用', '主屏幕怎么看，信息来了怎么处理')
p07_screen()
p08_read()
section(9, '03', '常用设置与保障', '个性设置、信息筛选、常见问题与保养')
p10_settings()
p11_filter()
p12_faq()
p13_ending()

out = 'DX-20S_行车安全信息终端.pptx'
prs.save(out)
print('SAVED', out, 'slides=', len(prs.slides._sldIdLst))
