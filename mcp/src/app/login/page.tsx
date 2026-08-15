import { safeMcpReturnTo } from "@/lib/mcp-session";

type Props = {
  searchParams?: { returnTo?: string; error?: string; state?: string };
};

const ERRORS: Record<string, string> = {
  invalid_credentials: "Tên đăng nhập hoặc mật khẩu không đúng.",
  auth_unavailable: "NPP Core tạm thời chưa sẵn sàng. Vui lòng thử lại.",
  owner_challenge_required: "Tài khoản Owner cần mã xác minh bổ sung.",
  owner_code_invalid: "Mã xác minh Owner không đúng.",
  owner_challenge_unavailable: "Chưa thể gửi mã xác minh Owner."
};

export default function LoginPage({ searchParams }: Props) {
  const returnTo = safeMcpReturnTo(searchParams?.returnTo);
  const message = searchParams?.error ? ERRORS[searchParams.error] : null;
  const ownerCodeRequired = searchParams?.state === "owner_code_required";
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f5efe5" }}>
      <form action="/api/auth/login" method="post" style={{ width: "min(100%, 420px)", display: "grid", gap: 14, padding: 22, borderRadius: 20, background: "white", boxShadow: "0 12px 36px rgba(60,40,20,.12)" }}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#754706" }}>NPP MCP FIELD</div>
          <h1 style={{ margin: "6px 0 4px", fontSize: 26 }}>Đăng nhập nhân viên</h1>
          <p style={{ margin: 0, color: "#6b6258" }}>Dùng tài khoản nhân sự NPP Core để mở danh sách khách thuộc phạm vi phụ trách.</p>
        </div>
        {message ? <p role="alert" style={{ margin: 0, padding: 10, borderRadius: 10, background: "#fff3e8" }}>{message}</p> : null}
        <label style={{ display: "grid", gap: 6 }}>
          <span>Tên đăng nhập</span>
          <input name="username" autoComplete="username" required style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: "1px solid #cfc6bb" }} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Mật khẩu</span>
          <input name="password" type="password" autoComplete="current-password" required style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: "1px solid #cfc6bb" }} />
        </label>
        {ownerCodeRequired ? (
          <label style={{ display: "grid", gap: 6 }}>
            <span>Mã xác minh Owner</span>
            <input name="ownerCode" inputMode="numeric" autoComplete="one-time-code" required style={{ minHeight: 44, padding: "0 12px", borderRadius: 10, border: "1px solid #cfc6bb" }} />
          </label>
        ) : null}
        <button type="submit" style={{ minHeight: 46, border: 0, borderRadius: 12, fontWeight: 800, background: "#754706", color: "white" }}>Đăng nhập</button>
      </form>
    </main>
  );
}
