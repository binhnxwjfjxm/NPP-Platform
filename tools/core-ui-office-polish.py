from __future__ import annotations

from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / "npp-core" / "web" / "app" / "organization" / "organization-workspace.tsx"
LOGO_SOURCE = ROOT / "logo-transparent.png"
LOGO_TARGET = ROOT / "npp-core" / "web" / "public" / "logo-transparent.png"


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match, found {count}: {old[:80]!r}")
    return text.replace(old, new, 1)


def replace_all_checked(text: str, old: str, new: str, minimum: int = 1) -> str:
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"Expected at least {minimum} matches, found {count}: {old!r}")
    return text.replace(old, new)


text = WORKSPACE.read_text(encoding="utf-8")

text = replace_once(
    text,
    """  useEffect(() => {\n    if (scope === 'overview') {\n      setLoading(false);\n      return;\n    }\n\n    void loadAll();\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [scope]);""",
    """  useEffect(() => {\n    setLoading(false);\n  }, [scope]);""",
)

replacements = [
    ("Yêu cầu tới gateway đã thất bại", "Không thể kết nối dịch vụ dữ liệu. Vui lòng thử lại."),
    ("Dữ liệu đã được đồng bộ.", "Dữ liệu đã được cập nhật."),
    ("Đang đồng bộ…", "Đang cập nhật…"),
    ("Làm mới", "Cập nhật dữ liệu"),
    ("NPP Core · Tổng quan dữ liệu", "Báo cáo quản trị"),
    ("NPP Core · Quản trị tổ chức", "Danh mục tổ chức và kho"),
    ("Lối tắt", "Danh mục nghiệp vụ"),
    ("Đi thẳng tới màn quản trị", "Truy cập nhanh"),
    ("Quan hệ dữ liệu", "Cơ cấu vận hành"),
    ("Cây tổ chức hiện có", "Cơ cấu chi nhánh và kho"),
    ("Hoạt động gần nhất", "Cập nhật gần đây"),
    ("Từ dữ liệu thật", "Dữ liệu hệ thống"),
    ("Danh sách dạng bảng", "Danh mục quản lý"),
    ("Tìm kiếm theo mã hoặc tên", "Tra cứu theo mã hoặc tên"),
    ("Không rõ chi nhánh", "Chưa xác định chi nhánh"),
    ("Không rõ chuỗi liên kết", "Chưa xác định quan hệ kho"),
    ("Chưa có dữ liệu chi nhánh để hiển thị cây tổ chức.", "Chưa có dữ liệu chi nhánh để hiển thị cơ cấu."),
    (">Sửa</button>", ">Chỉnh sửa</button>"),
    ("'Tắt' : 'Bật'", "'Ngừng dùng' : 'Kích hoạt'"),
    ("Thêm kho'", "Thêm kho hàng'"),
    ("<th>Thao tác</th>", "<th>Xử lý</th>"),
    ("<th>Liên kết</th>", "<th>Đơn vị liên quan</th>"),
    ("<th>Chuỗi liên kết</th>", "<th>Cơ cấu trực thuộc</th>"),
]

for old, new in replacements:
    text = replace_all_checked(text, old, new)

text = replace_all_checked(text, "bản ghi", "hồ sơ")
text = replace_all_checked(text, "Bản ghi", "Hồ sơ") if "Bản ghi" in text else text
text = replace_all_checked(text, "} dòng", "} hồ sơ", minimum=3)

WORKSPACE.write_text(text, encoding="utf-8")

if not LOGO_SOURCE.exists():
    raise RuntimeError("Root logo-transparent.png is missing")
LOGO_TARGET.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(LOGO_SOURCE, LOGO_TARGET)

print("Applied Core UI office polish and copied logo asset")
