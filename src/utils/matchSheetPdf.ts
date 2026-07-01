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
  contactInfo: string
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

// Layout constants
const W = 297
const H = 210
const ML = 8
const MR = 8
const MT = 8
const GAP = 4
const LOGO_W = 36
const LOGO_H = 22
const CW = (W - ML - MR - GAP) / 2

const NUM_W = 8
const INIT_W = 38       // widened for "Signature:" header
const INS_W = 11
const MVP_W = 15

const ROWS = 14
const ROW_H = 7.9

function drawPage(doc: jsPDF, fx: MatchSheetFixture, cfg: MatchSheetConfig) {
  const mvp = fx.mvpEnabled
  const NAME_W = CW - NUM_W - INIT_W - INS_W - (mvp ? MVP_W : 0)

  // Logo / contact block
  doc.setLineWidth(0.375)
  doc.rect(ML, MT, LOGO_W, LOGO_H)

  if (cfg.logoDataUrl) {
    try {
      doc.addImage(cfg.logoDataUrl, ML + 1, MT + 1, LOGO_W - 2, LOGO_H - 9)
    } catch { /* ignore bad image data */ }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    if (cfg.orgName) doc.text(cfg.orgName, ML + LOGO_W / 2, MT + LOGO_H + 4, { align: 'center', maxWidth: LOGO_W - 2 })
    doc.setFont('helvetica', 'normal')
    if (cfg.contactInfo) doc.text(cfg.contactInfo, ML + LOGO_W / 2, MT + LOGO_H + 9, { align: 'center', maxWidth: LOGO_W - 2 })
  } else {
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    if (cfg.orgName) {
      doc.text(cfg.orgName, ML + LOGO_W / 2, MT + LOGO_H / 2 - 2, { align: 'center', maxWidth: LOGO_W - 2 })
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11.5)
    if (cfg.contactInfo) {
      const lines = doc.splitTextToSize(cfg.contactInfo, LOGO_W - 2)
      doc.text(lines.slice(0, 3), ML + LOGO_W / 2, MT + LOGO_H / 2 + 3, { align: 'center' })
    }
    if (!cfg.orgName && !cfg.contactInfo) {
      doc.setTextColor(180)
      doc.setFontSize(12)
      doc.text('Logo / Contact', ML + LOGO_W / 2, MT + LOGO_H / 2 + 1, { align: 'center' })
      doc.setTextColor(0)
    }
  }

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(23)
  doc.text('MATCH SHEET', W / 2, MT + 7, { align: 'center' })

  const infoLine = [
    fx.venueName,
    fx.courtName ?? '',
    fmtDate(fx.scheduledDate),
    fmt12(fx.slotTime),
  ].filter(Boolean).join('   ·   ')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(17.5)
  doc.text(infoLine, W / 2, MT + 15, { align: 'center' })

  doc.setFontSize(13)
  doc.text(
    `Round ${fx.round}   ·   ${fx.divisionType} ${fx.divisionName}`,
    W - MR, MT + 21, { align: 'right' }
  )

  const rule1Y = MT + LOGO_H + 1
  doc.setLineWidth(0.5)
  doc.line(ML, rule1Y, W - MR, rule1Y)

  // Teams and score boxes
  const teamY = rule1Y + 11
  const boxW = 22, boxH = 14
  const cx = W / 2
  const boxTop = teamY - 9

  doc.setLineWidth(0.375)
  doc.rect(cx - boxW - 3, boxTop, boxW, boxH)
  doc.rect(cx + 3, boxTop, boxW, boxH)

  doc.setFontSize(23)
  doc.setFont('helvetica', 'bold')
  doc.text(':', cx, boxTop + boxH / 2 + 2.5, { align: 'center' })

  doc.setFontSize(24.5)
  doc.text(fx.homeTeamName, ML + CW / 2, teamY, { align: 'center', maxWidth: CW - 4 })

  // Away team shifted right to clear the score box
  const awayScoreBoxRight = cx + 3 + boxW
  const awayTextStart = awayScoreBoxRight + 4
  const awayTextEnd = W - MR
  const awayTextCentre = (awayTextStart + awayTextEnd) / 2
  const awayMaxWidth = awayTextEnd - awayTextStart
  doc.text(fx.awayTeamName ?? 'BYE', awayTextCentre, teamY, { align: 'center', maxWidth: awayMaxWidth })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text('HOME', ML + CW / 2, boxTop + boxH + 5, { align: 'center' })
  doc.text('AWAY', ML + CW + GAP + CW / 2, boxTop + boxH + 5, { align: 'center' })

  const rule2Y = boxTop + boxH + 8
  doc.setLineWidth(0.5)
  doc.line(ML, rule2Y, W - MR, rule2Y)

  // Player tables
  const tblTop = rule2Y + 0.5
  const tblH = ROW_H + ROWS * ROW_H

  const lx = ML
  const rx = ML + CW + GAP

  doc.setLineWidth(0.375)
  doc.rect(lx, tblTop, CW, tblH)
  doc.rect(rx, tblTop, CW, tblH)

  function drawColLines(ox: number) {
    doc.setLineWidth(0.25)
    doc.line(ox + NUM_W, tblTop, ox + NUM_W, tblTop + tblH)
    doc.line(ox + NUM_W + NAME_W, tblTop, ox + NUM_W + NAME_W, tblTop + tblH)
    doc.line(ox + NUM_W + NAME_W + INIT_W, tblTop, ox + NUM_W + NAME_W + INIT_W, tblTop + tblH)
    if (mvp) doc.line(ox + CW - MVP_W, tblTop, ox + CW - MVP_W, tblTop + tblH)
  }
  drawColLines(lx)
  drawColLines(rx)

  doc.setLineWidth(0.5)
  doc.line(lx, tblTop + ROW_H, lx + CW, tblTop + ROW_H)
  doc.line(rx, tblTop + ROW_H, rx + CW, tblTop + ROW_H)

  const headerTextY = tblTop + ROW_H - 1.5
  function drawHeader(ox: number) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('#', ox + NUM_W / 2, headerTextY, { align: 'center' })
    doc.text('Player Name', ox + NUM_W + 2, headerTextY)
    doc.text('Signature:', ox + NUM_W + NAME_W + INIT_W / 2, headerTextY, { align: 'center' })
    doc.text('Ins.', ox + NUM_W + NAME_W + INIT_W + INS_W / 2, headerTextY, { align: 'center' })
    if (mvp) doc.text('MVP', ox + CW - MVP_W / 2, headerTextY, { align: 'center' })
  }
  drawHeader(lx)
  drawHeader(rx)

  doc.setLineWidth(0.125)
  for (let r = 0; r < ROWS; r++) {
    const rowTop = tblTop + ROW_H + r * ROW_H
    const textY = rowTop + ROW_H - 1.8

    if (r < ROWS - 1) {
      doc.line(lx + 0.3, rowTop + ROW_H, lx + CW - 0.3, rowTop + ROW_H)
      doc.line(rx + 0.3, rowTop + ROW_H, rx + CW - 0.3, rowTop + ROW_H)
    }

    function drawPlayerRow(ox: number, player: MatchSheetPlayer | undefined) {
      const insX = ox + NUM_W + NAME_W + INIT_W + 1.5
      const insY = rowTop + ROW_H / 2 - 2
      const cbSize = 4
      doc.setLineWidth(0.25)
      doc.rect(insX, insY, cbSize, cbSize)

      if (player) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(12)
        doc.text(
          doc.splitTextToSize(player.name, NAME_W - 2)[0],
          ox + NUM_W + 2, textY
        )
        if (player.insured) {
          // Draw tick as two line segments (unicode does not render in jsPDF helvetica)
          doc.setLineWidth(0.6)
          const midX = insX + cbSize * 0.35
          const midY = insY + cbSize - 0.7
          doc.line(insX + 0.7, insY + cbSize * 0.55, midX, midY)
          doc.line(midX, midY, insX + cbSize - 0.3, insY + 0.5)
          doc.setLineWidth(0.25)
        }
      }
    }

    drawPlayerRow(lx, fx.homePlayers[r])
    drawPlayerRow(rx, fx.awayPlayers[r])
  }

  const tblBottom = tblTop + tblH

  // Referee line
  const refY = tblBottom + 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(14)
  const third = (W - ML - MR) / 3
  ;(['Referee', 'Signature', 'Date'] as const).forEach((label, i) => {
    const x = ML + i * third
    doc.text(`${label}:`, x, refY)
    doc.setLineWidth(0.375)
    doc.line(x + 20, refY, x + third - 4, refY)
  })

  // Notes
  const notesTop = refY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('NOTES', ML, notesTop - 1.5)

  doc.setLineWidth(0.375)
  doc.line(ML, notesTop, W - MR, notesTop)
  doc.line(ML, notesTop, ML, H)
  doc.line(W - MR, notesTop, W - MR, H)
}

export function generateMatchSheetsPDF(
  fixtures: MatchSheetFixture[],
  config: MatchSheetConfig,
  round: number,
  venueName: string,
  nightName: string,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  const filename = `TS_${slug(venueName)}_${slug(nightName)}_Round${round}.pdf`

  fixtures.forEach((fx, i) => {
    if (i > 0) doc.addPage()
    drawPage(doc, fx, config)
  })

  doc.save(filename)
}


