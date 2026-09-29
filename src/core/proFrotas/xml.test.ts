import { describe, it, expect } from 'vitest'
import { decodeXml, parseNfeXml } from './xml'

const KEY = '41260944555666000172550010000012341000012345'

// Como vem do portal DF-e da Receita do PR: a NF-e dentro de NFeLog/procNFe
function receitaXml({ tpNF = '1', vNF = '250.75', dest = '11222333000181' } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFeLog versao="1.00"><procNFe><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${KEY}" versao="4.00">
<ide><cUF>41</cUF><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-09-12T23:40:00-03:00</dhEmi><tpNF>${tpNF}</tpNF></ide>
<emit><CNPJ>44555666000172</CNPJ><xNome>POSTO ALFA LTDA</xNome><enderEmit><xMun>CURITIBA</xMun></enderEmit></emit>
<dest><CNPJ>${dest}</CNPJ><xNome>TRANSPORTADORA EXEMPLO LTDA</xNome></dest>
<det nItem="1"><prod><cProd>1</cProd><xProd>OLEO DIESEL S10</xProd><uCom>L</uCom><qCom>40.0000</qCom><vUnCom>6.1500</vUnCom><vProd>246.00</vProd></prod></det>
<det nItem="2"><prod><cProd>2</cProd><xProd>ARLA 32</xProd><uCom>L</uCom><qCom>1.0000</qCom><vUnCom>4.7500</vUnCom><vProd>4.75</vProd></prod></det>
<total><ICMSTot><vProd>250.75</vProd><vNF>${vNF}</vNF></ICMSTot></total>
</infNFe></NFe></procNFe></NFeLog>`
}

describe('parseNfeXml', () => {
  it('lê a NF-e do portal da Receita', () => {
    const result = parseNfeXml(receitaXml(), `${KEY}.xml`)
    expect(result).toEqual({
      kind: 'nfe',
      note: {
        key: KEY,
        number: '1234',
        series: '1',
        type: 1,
        issueDate: '2026-09-12',
        issuerCnpj: '44555666000172',
        issuerName: 'POSTO ALFA LTDA',
        recipientCnpj: '11222333000181',
        recipientName: 'TRANSPORTADORA EXEMPLO LTDA',
        amount: 250.75,
        fileName: `${KEY}.xml`,
        items: [
          { description: 'OLEO DIESEL S10', quantity: 40, unit: 'L', unitPrice: 6.15, total: 246 },
          { description: 'ARLA 32', quantity: 1, unit: 'L', unitPrice: 4.75, total: 4.75 },
        ],
      },
    })
  })

  it('a data de emissão é a do documento, sem conversão de fuso', () => {
    const result = parseNfeXml(receitaXml(), 'a.xml')
    expect(result.kind === 'nfe' && result.note.issueDate).toBe('2026-09-12')
  })

  it('lê também nfeProc com prefixo de namespace', () => {
    const xml = `<nfeProc xmlns:n="http://www.portalfiscal.inf.br/nfe"><n:NFe><n:infNFe Id="NFe${KEY}"><n:ide><n:nNF>0077</n:nNF><n:dEmi>2026-09-01</n:dEmi><n:tpNF>1</n:tpNF></n:ide><n:emit><n:CNPJ>44555666000172</n:CNPJ></n:emit><n:dest><n:CNPJ>11222333000181</n:CNPJ></n:dest><n:total><n:ICMSTot><n:vNF>10.00</n:vNF></n:ICMSTot></n:total></n:infNFe></n:NFe></nfeProc>`
    const result = parseNfeXml(xml, 'b.xml')
    expect(result).toMatchObject({ kind: 'nfe', note: { number: '77', issueDate: '2026-09-01', amount: 10 } })
  })

  it('evento ou outro documento fica de fora sem ser erro', () => {
    expect(parseNfeXml('<procEventoNFe><evento><infEvento><tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>', 'ev.xml')).toEqual({ kind: 'other' })
  })

  it('XML quebrado é erro', () => {
    expect(parseNfeXml('<NFe><infNFe>', 'x.xml').kind).toBe('error')
  })

  it('NF-e sem valor total é erro', () => {
    expect(parseNfeXml(receitaXml({ vNF: '' }), 'x.xml')).toEqual({ kind: 'error', message: 'NF-e sem valor total (vNF)' })
  })
})

describe('decodeXml', () => {
  it('respeita ISO-8859-1 declarado', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><x>'), 0xc7, 0xc3, 0x4f, ...new TextEncoder().encode('</x>')])
    expect(decodeXml(bytes)).toContain('<x>ÇÃO</x>')
  })

  it('UTF-8 é o padrão', () => {
    expect(decodeXml(new TextEncoder().encode('<x>AÇÃO</x>'))).toBe('<x>AÇÃO</x>')
  })
})
