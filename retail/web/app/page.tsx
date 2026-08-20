const upcoming = [
  {
    title: 'Lên đơn',
    detail: 'Tạo đơn bán tại quầy và chọn nhiều sản phẩm trong một lần.',
  },
  {
    title: 'Xuất kho',
    detail: 'Dùng cùng luồng xử lý trực tiếp của Công Ty, không tạo sổ tồn riêng.',
  },
  {
    title: 'Thu tiền / Nợ',
    detail: 'Ghi nhận thanh toán và công nợ trên cùng dữ liệu chính thức của Công Ty.',
  },
];

export default function RetailHomePage() {
  return (
    <main className="retail-shell">
      <section className="hero-card">
        <div>
          <p className="brand-kicker">HƯNG PHÁT</p>
          <h1>Bán tại quầy</h1>
          <p className="hero-copy">
            Một màn hình gọn cho nhân viên tại quầy, dùng chung dữ liệu và nghiệp vụ Công Ty.
          </p>
        </div>
        <div className="status-pill" aria-label="Trạng thái ứng dụng">
          <span className="status-dot" aria-hidden="true" />
          Nền tảng đã sẵn sàng
        </div>
      </section>

      <section className="section-block" aria-labelledby="next-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">KHUNG ỨNG DỤNG</p>
            <h2 id="next-title">Các bước bán tại quầy</h2>
          </div>
          <span className="phase-tag">Lô 0</span>
        </div>

        <div className="feature-grid">
          {upcoming.map((item, index) => (
            <article className="feature-card" key={item.title}>
              <span className="feature-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="boundary-card">
        <strong>Ranh giới dữ liệu</strong>
        <p>
          Retail chỉ là ứng dụng làm việc tại quầy. Sản phẩm, giá, tồn kho, đơn bán, công nợ và thanh toán vẫn thuộc hệ thống Công Ty.
        </p>
      </section>
    </main>
  );
}
