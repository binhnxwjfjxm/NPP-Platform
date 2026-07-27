#!/usr/bin/env python3
import json
import math
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'pr': 'http://schemas.openxmlformats.org/package/2006/relationships',
}


def col_index(ref):
    letters = ''.join(ch for ch in ref if ch.isalpha())
    value = 0
    for ch in letters:
        value = value * 26 + ord(ch.upper()) - 64
    return value - 1


def read_xlsx(path):
    with zipfile.ZipFile(path) as archive:
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            for item in root.findall('a:si', NS):
                shared.append(''.join(node.text or '' for node in item.iterfind('.//a:t', NS)))

        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        relation_map = {item.attrib['Id']: item.attrib['Target'] for item in relationships.findall('pr:Relationship', NS)}
        result = {}
        relationship_id = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

        for sheet in workbook.findall('a:sheets/a:sheet', NS):
            name = sheet.attrib['name']
            target = relation_map[sheet.attrib[relationship_id]].lstrip('/')
            if not target.startswith('xl/'):
                target = 'xl/' + target
            root = ET.fromstring(archive.read(target))
            rows = []
            for row in root.findall('.//a:sheetData/a:row', NS):
                cells = {}
                for cell in row.findall('a:c', NS):
                    index = col_index(cell.attrib.get('r', ''))
                    cell_type = cell.attrib.get('t')
                    value_node = cell.find('a:v', NS)
                    inline = cell.find('a:is', NS)
                    if cell_type == 's' and value_node is not None:
                        value = shared[int(value_node.text)]
                    elif cell_type == 'inlineStr' and inline is not None:
                        value = ''.join(node.text or '' for node in inline.iterfind('.//a:t', NS))
                    elif cell_type == 'b' and value_node is not None:
                        value = value_node.text == '1'
                    elif value_node is None:
                        value = None
                    else:
                        raw = value_node.text
                        try:
                            number = float(raw)
                            value = int(number) if number.is_integer() else number
                        except (TypeError, ValueError):
                            value = raw
                    cells[index] = value
                if cells:
                    values = [None] * (max(cells) + 1)
                    for index, value in cells.items():
                        values[index] = value
                    rows.append(values)
            result[name] = rows
        return result


def records(rows, header_row=0):
    header = [str(value).strip() if value is not None else '' for value in rows[header_row]]
    result = []
    for row_number, row in enumerate(rows[header_row + 1:], start=header_row + 2):
        padded = row + [None] * (len(header) - len(row))
        result.append((row_number, {header[index]: padded[index] for index in range(len(header)) if header[index]}))
    return result


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def text(value):
    return str(value).strip() if value is not None else ''


def audit(canonical_path, venue_path):
    canonical = read_xlsx(canonical_path)
    venue = read_xlsx(venue_path)
    missing = sorted({'MASTER_CHUAN', 'GIA_THUNG_GOC', 'CAP_NHAT_DS_SP'} - canonical.keys())
    missing += sorted({'MAP_CHI_TIET'} - venue.keys())
    if missing:
        raise SystemExit('missing worksheets: ' + ', '.join(missing))

    master = [(row, item) for row, item in records(canonical['MASTER_CHUAN']) if text(item.get('SKU đơn vị'))]
    carton = [(row, item) for row, item in records(canonical['GIA_THUNG_GOC']) if text(item.get('Mã SKU của sản phẩm quy đổi*'))]
    updated = [(row, item) for row, item in records(canonical['CAP_NHAT_DS_SP']) if text(item.get('SKU đơn vị'))]
    venue_rows = [(row, item) for row, item in records(venue['MAP_CHI_TIET']) if text(item.get('SKU lẻ'))]

    base_skus = [text(item.get('SKU đơn vị')).upper() for _, item in master]
    carton_skus = [text(item.get('SKU quy đổi')).upper() for _, item in master]
    venue_skus = [text(item.get('SKU lẻ')).upper() for _, item in venue_rows]
    status_counts = Counter(text(item.get('Trạng thái dòng')) for _, item in venue_rows)
    review_rows = [
        (row, text(item.get('SKU lẻ')), text(item.get('Trạng thái dòng')))
        for row, item in venue_rows
        if 'CẦN DUYỆT' in text(item.get('Trạng thái dòng')).upper()
    ]

    return {
        'schemaVersion': 1,
        'canonicalWorkbook': Path(canonical_path).name,
        'venueWorkbook': Path(venue_path).name,
        'canonical': {
            'masterRows': len(master),
            'uniqueBaseSkus': len(set(base_skus)),
            'uniqueCartonSkus': len(set(carton_skus)),
            'duplicateBaseSkus': sorted([sku for sku, count in Counter(base_skus).items() if count > 1]),
            'duplicateCartonSkus': sorted([sku for sku, count in Counter(carton_skus).items() if count > 1]),
            'basePriceAfterUpdatePositive': sum(positive(item.get('Giá lẻ sau cập nhật')) for _, item in master),
            'basePriceAfterUpdateMissingOrZero': sum(not positive(item.get('Giá lẻ sau cập nhật')) for _, item in master),
            'baseNormalizedPricePositive': sum(positive(item.get('Giá lẻ đơn vị chuẩn')) for _, item in master),
            'cartonNormalizedPricePositive': sum(positive(item.get('Giá lẻ quy đổi chuẩn')) for _, item in master),
            'cartonWorkbookRows': len(carton),
            'cartonRetailPricePositive': sum(positive(item.get('PL_Giá bán lẻ')) for _, item in carton),
            'updatedProductRows': len(updated),
            'updatedProductPricePositive': sum(positive(item.get('Giá sau cập nhật')) for _, item in updated),
        },
        'venueChannel': {
            'mappedRows': len(venue_rows),
            'uniqueSkus': len(set(venue_skus)),
            'duplicateSkuRows': len(venue_skus) - len(set(venue_skus)),
            'positivePriceRows': sum(positive(item.get('Giá chuẩn (VND)')) for _, item in venue_rows),
            'missingOrZeroPriceRows': sum(not positive(item.get('Giá chuẩn (VND)')) for _, item in venue_rows),
            'reviewRequiredRows': len(review_rows),
            'statusCounts': dict(sorted(status_counts.items())),
            'reviewSamples': [
                {'row': row, 'sku': sku, 'status': status}
                for row, sku, status in review_rows[:20]
            ],
        },
        'rules': {
            'retailAndCartonIndependent': True,
            'deriveCartonFromRetailTimesConversion': False,
            'venuePricesUseDedicatedChannel': True,
            'ambiguousRowsBlocked': True,
            'zeroPricesNotImported': True,
        },
    }


def main(argv):
    if len(argv) != 3:
        raise SystemExit('usage: audit-pricing-workbooks.py canonical.xlsx venue.xlsx')
    print(json.dumps(audit(argv[1], argv[2]), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main(sys.argv)
