import { describe, it, expect } from 'vitest'
import { decodeOfx, parseOfx } from './ofx'

// Trecho no formato do OFX que o Itaú exporta (SGML, CHARSET 1252)
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM>
<BANKID>0341
<ACCTID>1234567890
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260916100000[-03:EST]
<DTEND>20260917100000[-03:EST]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260916100000[-03:EST]
<TRNAMT>-26153.64
<FITID>20260916003
<MEMO>SISPAG TRIBUTOS DAS SIMPLES NACIONAL 00.394.460/0058-87
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260916100000[-03:EST]
<TRNAMT>-695.00
<FITID>20260916006
<MEMO>PAGAMENTOS A FORNECEDORES AUTO MECANICA E GUINCHOS EXEMPLO 33.333.333/0001-33
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260917100000[-03:EST]
<TRNAMT>350.00
<FITID>20260917001
<MEMO>PIX RECEBIDO CICLANO16/09 CICLANO DE OLIVEIRA 666.666.666-66
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>9787202.84
<DTASOF>20260917100000[-03:EST]
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

describe('parseOfx', () => {
  it('lê conta, período, saldo e lançamentos com favorecido e documento', () => {
    const statement = parseOfx(OFX, 'extrato.ofx')
    expect(statement).toMatchObject({
      source: 'ofx',
      account: '1234 / 56789-0',
      period: { start: '2026-09-16', end: '2026-09-17' },
      closingBalance: 9787202.84,
      warnings: [],
    })
    expect(statement.movements.map((m) => [m.date, m.amount, m.kind, m.family, m.counterparty, m.document])).toEqual([
      ['2026-09-16', -26153.64, 'payment', 'tax', 'DAS SIMPLES NACIONAL', '00.394.460/0058-87'],
      ['2026-09-16', -695, 'payment', 'supplier', 'AUTO MECANICA E GUINCHOS EXEMPLO', '33.333.333/0001-33'],
      ['2026-09-17', 350, 'other', null, 'PIX RECEBIDO CICLANO16/09 CICLANO DE OLIVEIRA', '666.666.666-66'],
    ])
  })

  it('decodifica pelo charset do cabeçalho', () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode('CHARSET:1252\n<OFX><MEMO>'), 0xc7, 0xc3, 0x4f])
    expect(decodeOfx(bytes)).toContain('ÇÃO')
  })

  it('arquivo que não é OFX dá erro', () => {
    expect(() => parseOfx('Data;Histórico;Valor', 'x.ofx')).toThrow(/não parece um OFX/)
  })
})
