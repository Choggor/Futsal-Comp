import jsPDF from 'jspdf'

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
  homePlayers: string[]
  awayPlayers: string[]
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

const W = 297
const H = 210
const ML = 8   // left margin
const MR = 8   // right margin
const MT = 8   // top margin
const GAP = 4  // gap between the two player columns
const CW = (W - ML - MR - GAP) / 2  // ~138.5mm per column

// Column widths within each player table half
const NUM_W = 10   // "#" column
const MVP_W = 16   // "MVP" column
const ROWS = 14
const ROW_H = 6.5

function drawPage(doc: jsPDF, fx: MatchSheetFixture) {
  const mvp = fx.mvpEnabled
  const NAME_W = CW - NUM_W - (mvp ? MVP_W : 0)

  // ── Header ─────────────────────────────────────────────────────────────────

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('MATCH SHEET', W / 2, MT + 5, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)

  const infoLeft = [
    fx.venueName,
    fx.courtName ?? '',
    fmtDate(fx.scheduledDate),
    fmt12(fx.slotTime),
  ].filter(Boolean).join('   ·   ')

  const infoRight = `Round ${fx.round}   ·   ${fx.divisionType} ${fx.divisionName}`

  doc.text(infoLeft, ML, MT + 11)
  doc.text(infoRight, W - MR, MT + 11, { align: 'right' })

  const rule1Y = MT + 14
  doc.setLineWidth(0.4)
  doc.line(ML, rule1Y, W - MR, rule1Y)

  // ── Teams + score ───────────────────────────────────────────────────────────

  const teamY = rule1Y + 11  // vertical centre of score boxes

  // Score boxes
  const boxW = 22, boxH = 14
  const cx = W / 2
  const boxTop = teamY - 9
  doc.setLineWidth(0.8)
  doc.rect(cx - boxW - 3, boxTop, boxW, boxH)  // home score
  doc.rect(cx + 3, boxTop, boxW, boxH)          // away score
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(':', cx, boxTop + boxH / 2 + 2.5, { align: 'center' })

  // Team names
  doc.setFontSize(14)
  doc.text(fx.homeTeamName, ML + CW / 2, teamY, { align: 'center', maxWidth: CW - 4 })
  doc.text(fx.awayTeamName ?? 'BYE', ML + CW + GAP + CW / 2, teamY, { align: 'center', maxWidth: CW - 4 })

  // HOME / AWAY labels
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('HOME', ML + CW / 2, boxTop + boxH + 5, { align: 'center' })
  doc.text('AWAY', ML + CW + GAP + CW / 2, boxTop + boxH + 5, { align: 'center' })

  const rule2Y = boxTop + boxH + 8
  doc.setLineWidth(0.4)
  doc.line(ML, rule2Y, W - MR, rule2Y)

  // ── Player table ────────────────────────────────────────────────────────────

  const tblTop = rule2Y + 0.5  // top of table border
  const tblH = ROW_H + ROWS * ROW_H  // header row + data rows
  const headerTextY = tblTop + ROW_H - 1.5

  // Outer rectangles (left table, right table)
  const lx = ML
  const rx = ML + CW + GAP
  doc.setLineWidth(0.3)
  doc.rect(lx, tblTop, CW, tblH)
  doc.rect(rx, tblTop, CW, tblH)

  // Header dividers
  doc.setLineWidth(0.2)
  // Left: # | Name | MVP
  doc.line(lx + NUM_W, tblTop, lx + NUM_W, tblTop + tblH)
  if (mvp) doc.line(lx + CW - MVP_W, tblTop, lx + CW - MVP_W, tblTop + tblH)
  // Right: # | Name | MVP
  doc.line(rx + NUM_W, tblTop, rx + NUM_W, tblTop + tblH)
  if (mvp) doc.line(rx + CW - MVP_W, tblTop, rx + CW - MVP_W, tblTop + tblH)

  // Header row bottom rule
  doc.setLineWidth(0.4)
  doc.line(lx, tblTop + ROW_H, lx + CW, tblTop + ROW_H)
  doc.line(rx, tblTop + ROW_H, rx + CW, tblTop + ROW_H)

  // Header text
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('#', lx + NUM_W / 2, headerTextY, { align: 'center' })
  doc.text('Player Name', lx + NUM_W + 2, headerTextY)
  if (mvp) doc.text('MVP', lx + CW - MVP_W / 2, headerTextY, { align: 'center' })

  doc.text('#', rx + NUM_W / 2, headerTextY, { align: 'center' })
  doc.text('Player Name', rx + NUM_W + 2, headerTextY)
  if (mvp) doc.text('MVP', rx + CW - MVP_W / 2, headerTextY, { align: 'center' })

  // Data rows
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setLineWidth(0.1)

  for (let r = 0; r < ROWS; r++) {
    const rowTop = tblTop + ROW_H + r * ROW_H
    const textY = rowTop + ROW_H - 1.8

    // Row separator (not after last row — outer rect handles that)
    if (r < ROWS - 1) {
      doc.line(lx + 0.3, rowTop + ROW_H, lx + CW - 0.3, rowTop + ROW_H)
      doc.line(rx + 0.3, rowTop + ROW_H, rx + CW - 0.3, rowTop + ROW_H)
    }

    // Left player
    const lp = fx.homePlayers[r]
    if (lp) {
      doc.text(
        doc.splitTextToSize(lp, NAME_W - 3)[0],
        lx + NUM_W + 2, textY
      )
    }

    // Right player
    const rp = fx.awayPlayers[r]
    if (rp) {
      doc.text(
        doc.splitTextToSize(rp, NAME_W - 3)[0],
        rx + NUM_W + 2, textY
      )
    }
  }

  const tblBottom = tblTop + tblH

  // ── Referee line ────────────────────────────────────────────────────────────

  const refY = tblBottom + 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const refLineW = (W - ML - MR) / 3 - 4
  const labels = ['Referee', 'Signature', 'Date']
  labels.forEach((label, i) => {
    const x = ML + i * ((W - ML - MR) / 3)
    doc.text(`${label}:`, x, refY)
    doc.setLineWidth(0.3)
    doc.line(x + 18, refY, x + 18 + refLineW, refY)
  })

  // ── Notes ───────────────────────────────────────────────────────────────────

  const notesTop = refY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('NOTES', ML, notesTop - 1)

  doc.setLineWidth(0.3)
  // Left border
  doc.line(ML, notesTop, ML, H)
  // Right border
  doc.line(W - MR, notesTop, W - MR, H)
  // Top border
  doc.line(ML, notesTop, W - MR, notesTop)
  // No bottom border — intentionally open so notes spill to reverse
}

export function generateMatchSheetsPDF(fixtures: MatchSheetFixture[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  fixtures.forEach((fx, i) => {
    if (i > 0) doc.addPage()
    drawPage(doc, fx)
  })

  doc.save('match-sheets.pdf')
}
