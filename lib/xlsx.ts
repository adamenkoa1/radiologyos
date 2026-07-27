import { strToU8, zipSync } from "fflate";
import { ReportColumn, ReportRecord, valueForColumn } from "./reporting";

function xml(value:string | number) {
  return String(value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&apos;");
}

function columnName(index:number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cell(reference:string,value:string | number,style:number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}" t="n"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

export function createXlsx(title:string,columns:ReportColumn[],rows:ReportRecord[]) {
  const widths = columns.map((item,index) => {
    const contentWidth = rows.slice(0,500).reduce(
      (max,row)=>Math.max(max,String(valueForColumn(row,item.key)).length),
      item.label.length
    );
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(48,Math.max(12,contentWidth + 2))}" customWidth="1"/>`;
  }).join("");

  const header = `<row r="1" ht="24" customHeight="1">${columns.map((item,index)=>
    cell(`${columnName(index)}1`,item.label,1)
  ).join("")}</row>`;
  const body = rows.map((row,rowIndex) => {
    const number = rowIndex + 2;
    const cells = columns.map((item,columnIndex)=>
      cell(`${columnName(columnIndex)}${number}`,valueForColumn(row,item.key),item.kind === "money" ? 2 : 0)
    ).join("");
    return `<row r="${number}">${cells}</row>`;
  }).join("");
  const lastColumn = columnName(Math.max(0,columns.length - 1));
  const lastRow = Math.max(1,rows.length + 1);

  const files:Record<string,Uint8Array> = {
    "[Content_Types].xml":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
        <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
      </Types>`),
    "_rels/.rels":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
      </Relationships>`),
    "docProps/core.xml":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <dc:title>${xml(title)}</dc:title><dc:creator>RadiologyOS</dc:creator>
        <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
      </cp:coreProperties>`),
    "docProps/app.xml":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
        <Application>RadiologyOS</Application>
      </Properties>`),
    "xl/workbook.xml":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="${xml(title.slice(0,31))}" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`),
    "xl/styles.xml":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0 &quot;грн&quot;"/></numFmts>
        <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>
        <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0D5B50"/><bgColor indexed="64"/></patternFill></fill></fills>
        <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
        <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
        <cellXfs count="3">
          <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
          <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
          <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        </cellXfs>
        <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
      </styleSheet>`),
    "xl/worksheets/sheet1.xml":strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <dimension ref="A1:${lastColumn}${lastRow}"/>
        <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
        <cols>${widths}</cols>
        <sheetData>${header}${body}</sheetData>
        <autoFilter ref="A1:${lastColumn}${lastRow}"/>
      </worksheet>`),
  };
  return zipSync(files,{ level:6 });
}
