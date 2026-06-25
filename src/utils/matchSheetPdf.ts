import jsPDF from 'jspdf'

export interface MatchSheetPlayer {
  name: string
  insured: boolean // true if insurance_expiry >= today
}

export interface MatchSheetFixture {
  round: number
  scheduledDate: string | null
  slotTime: string | null
  courtName: string | null
  venueName: string
  mvpEnabled: boolean
  divisionType: string
  divisionName: string
  homeTeamName: string
  awayTeamName: string | null
  homePlayers: MatchSheetPlayer[]
  awayPlayers: MatchSheetPlayer[]
}

export interface MatchSheetConfig {
  orgName: string
  contactInfo: string   // e.g. "phone · email · website" on one line
  logoDataUrl: string | null
}

function fmt12(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour < 12 ? 'am' : 'pm'}`
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  const [y, mo, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(mo) - 1]} ${y}`
}

// ── Layout constants ──────────────────────────────────────────────────────────

const W = 297
const H = 210
const ML = 8
const MR = 8
const MT = 8
const GAP = 4           // gap between the two player-table halves
const LOGO_W = 36       // logo/contact block width
const LOGO_H = 22       // logo/contact block height
const CW = (W - ML - MR - GAP) / 2  // ~138.5mm per team column

// Player table column widths (fit inside CW)
const NUM_W = 8         // "#"
const INIT_W = 24       // "Init." — wide enough for a signature-style initial
const INS_W = 11        // "Ins." checkbox
const MVP_W = 15        // "MVP" (only when enabled)

const ROWS = 14
const ROW_H = 7.9       // larger rows; naturally shrinks notes to ~half height

// ── Draw one page ─────────────────────────────────────────────────────────────

function drawPage(doc: jsPDF, fx: MatchSheetFixture, cfg: MatchSheetConfig) {
  const mvp = fx.mvpEnabled
  const NAME_W = CW - NUM_W - INIT_W - INS_W - (mvp ? MVP_W : 0)

  // ── Logo / contact block ────────────────────────────────────────────────────

  doc.setLineWidth(0.3)
  doc.rect(ML, MT, LOGO_W, LOGO_H)

  if (cfg.logoDataUrl) {
    try {
      // Fit logo into top portion of the block, leaving room for text below
      doc.addImage(cfg.logoDataUrl, ML + 1, MT + 1, LOGO_W - 2, LOGO_H - 9)
    } catch { /* ignore bad image data */ }
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    if (cfg.orgName) doc.text(cfg.orgName, ML + LOGO_W / 2, MT + LOGO_H - 6, { align: 'center', maxWidth: LOGO_W - 2 })
    doc.setFont('helvetica', 'normal')
    if (cfg.contactInfo) doc.text(cfg.contactInfo, ML + LOGO_W / 2, MT + LOGO_H - 2, { align: 'center', maxWidth: LOGO_W - 2 })
  } else {
    // No logo — show org name + contact centred in the box
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    if (cfg.orgName) {
      doc.text(cfg.orgName, ML + LOGO_W / 2, MT + LOGO_H / 2 - 2, { align: 'center', maxWidth: LOGO_W - 2 })
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    if (cfg.contactInfo) {
      const lines = doc.splitTextToSize(cfg.contactInfo, LOGO_W - 2)
      doc.text(lines.slice(0, 3), ML + LOGO_W / 2, MT + LOGO_H / 2 + 3, { align: 'center' })
    }
    if (!cfg.orgName && !cfg.contactInfo) {
      doc.setTextColor(180)
      doc.setFontSize(7)
      doc.text('Logo / Contact', ML + LOGO_W / 2, MT + LOGO_H / 2 + 1, { align: 'center' })
      doc.setTextColor(0)
    }
  }

  // ── Header — centred across full page width ────────────────────────────────

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('MATCH SHEET', W / 2, MT + 7, { align: 'center' })

  const infoLine = [
    fx.venueName,
    fx.courtName ?? '',
    fmtDate(fx.scheduledDate),
    fmt12(fx.slotTime),
  ].filter(Boolean).join('   ·   ')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(infoLine, W / 2, MT + 15, { align: 'center' })

  doc.setFontSize(7.5)
  doc.text(
    `Round ${fx.round}   ·   ${fx.divisionType} ${fx.divisionName}`,
    W - MR, MT + 21, { align: 'right' }
  )

  const rule1Y = MT + LOGO_H + 1
  doc.setLineWidth(0.4)
  doc.line(ML, rule1Y, W - MR, rule1Y)

  // ── Teams + score boxes ────────────────────────────────────────────────────

  const teamY = rule1Y + 11
  const boxW = 22, boxH = 14
  const cx = W / 2
  const boxTop = teamY - 9

  doc.setLineWidth(0.8)
  doc.rect(cx - boxW - 3, boxTop, boxW, boxH)
  doc.rect(cx + 3, boxTop, boxW, boxH)

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(':', cx, boxTop + boxH / 2 + 2.5, { align: 'center' })

  doc.setFontSize(14)
  doc.text(fx.homeTeamName, ML + CW / 2, teamY, { align: 'center', maxWidth: CW - 4 })
  doc.text(fx.awayTeamName ?? 'BYE', ML + CW + GAP + CW / 2, teamY, { align: 'center', maxWidth: CW - 4 })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('HOME', ML + CW / 2, boxTop + boxH + 5, { align: 'center' })
  doc.text('AWAY', ML + CW + GAP + CW / 2, boxTop + boxH + 5, { align: 'center' })

  const rule2Y = boxTop + boxH + 8
  doc.setLineWidth(0.4)
  doc.line(ML, rule2Y, W - MR, rule2Y)

  // ── Player tables ──────────────────────────────────────────────────────────

  const tblTop = rule2Y + 0.5
  const tblH = ROW_H + ROWS * ROW_H   // header + data rows

  const lx = ML
  const rx = ML + CW + GAP

  // Outer rectangles
  doc.setLineWidth(0.3)
  doc.rect(lx, tblTop, CW, tblH)
  doc.rect(rx, tblTop, CW, tblH)

  // Internal column separator lines (both halves share the same relative offsets)
  function drawColLines(ox: number) {
    doc.setLineWidth(0.2)
    doc.line(ox + NUM_W, tblTop, ox + NUM_W, tblTop + tblH)
    doc.line(ox + NUM_W + NAME_W, tblTop, ox + NUM_W + NAME_W, tblTop + tblH)
    doc.line(ox + NUM_W + NAME_W + INIT_W, tblTop, ox + NUM_W + NAME_W + INIT_W, tblTop + tblH)
    if (mvp) doc.line(ox + CW - MVP_W, tblTop, ox + CW - MVP_W, tblTop + tblH)
  }
  drawColLines(lx)
  drawColLines(rx)

  // Header row bottom rule
  doc.setLineWidth(0.4)
  doc.line(lx, tblTop + ROW_H, lx + CW, tblTop + ROW_H)
  doc.line(rx, tblTop + ROW_H, rx + CW, tblTop + ROW_H)

  // Header text
  const headerTextY = tblTop + ROW_H - 1.5
  function drawHeader(ox: number) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('#', ox + NUM_W / 2, headerTextY, { align: 'center' })
    doc.text('Player Name', ox + NUM_W + 2, headerTextY)
    doc.text('Init.', ox + NUM_W + NAME_W + INIT_W / 2, headerTextY, { align: 'center' })
    doc.text('Ins.', ox + NUM_W + NAME_W + INIT_W + INS_W / 2, headerTextY, { align: 'center' })
    if (mvp) doc.text('MVP', ox + CW - MVP_W / 2, headerTextY, { align: 'center' })
  }
  drawHeader(lx)
  drawHeader(rx)

  // Data rows
  doc.setLineWidth(0.1)
  for (let r = 0; r < ROWS; r++) {
    const rowTop = tblTop + ROW_H + r * ROW_H
    const textY = rowTop + ROW_H - 1.8

    // Row separator (skip last — outer rect handles it)
    if (r < ROWS - 1) {
      doc.line(lx + 0.3, rowTop + ROW_H, lx + CW - 0.3, rowTop + ROW_H)
      doc.line(rx + 0.3, rowTop + ROW_H, rx + CW - 0.3, rowTop + ROW_H)
    }

    function drawPlayerRow(ox: number, player: MatchSheetPlayer | undefined) {
      // Insurance checkbox (small square centred in the Ins. cell)
      const insX = ox + NUM_W + NAME_W + INIT_W + 1.5
      const insY = rowTop + ROW_H / 2 - 2
      const cbSize = 4
      doc.setLineWidth(0.2)
      doc.rect(insX, insY, cbSize, cbSize)

      if (player) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text(
          doc.splitTextToSize(player.name, NAME_W - 2)[0],
          ox + NUM_W + 2, textY
        )
        if (player.insured) {
          // Tick inside checkbox
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.text('✓', insX + cbSize / 2, insY + cbSize - 0.5, { align: 'center' })
        }
      }
    }

    drawPlayerRow(lx, fx.homePlayers[r])
    drawPlayerRow(rx, fx.awayPlayers[r])
  }

  const tblBottom = tblTop + tblH

  // ── Referee line ────────────────────────────────────────────────────────────

  const refY = tblBottom + 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const third = (W - ML - MR) / 3
  ;(['Referee', 'Signature', 'Date'] as const).forEach((label, i) => {
    const x = ML + i * third
    doc.text(`${label}:`, x, refY)
    doc.setLineWidth(0.3)
    doc.line(x + 20, refY, x + third - 4, refY)
  })

  // ── Notes (open bottom so it spills to reverse) ─────────────────────────────

  const notesTop = refY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('NOTES', ML, notesTop - 1.5)

  doc.setLineWidth(0.3)
  doc.line(ML, notesTop, W - MR, notesTop)   // top border
  doc.line(ML, notesTop, ML, H)               // left border (to page edge)
  doc.line(W - MR, notesTop, W - MR, H)      // right border (to page edge)
  // no bottom border — intentionally open
}

// ── Public entry point ────────────────────────────────────────────────────────

export function generateMatchSheetsPDF(
  fixtures: MatchSheetFixture[],
  config: MatchSheetConfig,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  fixtures.forEach((fx, i) => {
    if (i > 0) doc.addPage()
    drawPage(doc, fx, config)
  })

  doc.save('match-sheets.pdf')
}
