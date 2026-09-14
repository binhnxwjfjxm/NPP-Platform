-- Công Ty: tăng tốc tìm hàng khi lập đơn mà không đổi dữ liệu nghiệp vụ.
-- pg_trgm hỗ trợ contains-search trên SKU, tên hàng, mã sản phẩm và barcode.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS product_variants_sales_search_sku_trgm_idx
  ON shared.product_variants USING gin (
    (translate(lower(sku),
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) gin_trgm_ops
  )
  WHERE is_active = true AND is_sellable = true;

CREATE INDEX IF NOT EXISTS product_variants_sales_search_name_trgm_idx
  ON shared.product_variants USING gin (
    (translate(lower(name),
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) gin_trgm_ops
  )
  WHERE is_active = true AND is_sellable = true;

CREATE INDEX IF NOT EXISTS products_sales_search_code_trgm_idx
  ON shared.products USING gin (
    (translate(lower(code),
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) gin_trgm_ops
  )
  WHERE is_active = true AND is_orderable = true;

CREATE INDEX IF NOT EXISTS products_sales_search_name_trgm_idx
  ON shared.products USING gin (
    (translate(lower(name),
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')) gin_trgm_ops
  )
  WHERE is_active = true AND is_orderable = true;

CREATE INDEX IF NOT EXISTS product_barcodes_sales_search_value_trgm_idx
  ON shared.product_barcodes USING gin ((lower(normalized_barcode)) gin_trgm_ops)
  WHERE is_active = true;
