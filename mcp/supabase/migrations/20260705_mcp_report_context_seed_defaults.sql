-- Seed global defaults for Phase 6 contextual report UI.
-- These are global fallback options, not route-bound templates.

insert into public.mcp_report_templates (id, title, report_type, scope_type, content, price_summary, competitor_summary, display_summary, opportunity_summary, risk_summary, next_action, sort_order, note, raw_payload)
values
  ('mrt_global_price_watch', 'Mẫu khảo sát giá', 'price', 'global', 'Ghi nhận giá bán thực tế tại điểm bán.', 'Giá hiện tại / chương trình / chênh lệch so với đối thủ.', '', '', 'Cơ hội điều chỉnh giá hoặc combo.', 'Rủi ro mất khách vì giá.', 'Theo dõi giá và đề xuất chính sách.', 10, 'Global contextual template', '{"seed":"phase_6"}'::jsonb),
  ('mrt_global_competitor_watch', 'Mẫu đối thủ', 'competitor', 'global', 'Ghi nhận đối thủ đang hiện diện tại điểm bán.', '', 'Đối thủ / SKU / giá / ưu đãi / độ phủ.', 'Vị trí trưng bày của đối thủ nếu có.', 'Cơ hội lấy lại điểm bán.', 'Rủi ro bị chiếm kệ hoặc mất đơn.', 'Lên kế hoạch xử lý đối thủ.', 20, 'Global contextual template', '{"seed":"phase_6"}'::jsonb),
  ('mrt_global_display_watch', 'Mẫu trưng bày', 'display', 'global', 'Ghi nhận tình trạng trưng bày tại điểm bán.', '', '', 'Vị trí, diện tích, hình ảnh, vật phẩm POSM.', 'Cơ hội tăng nhận diện.', 'Rủi ro bị khuất hoặc thiếu vật phẩm.', 'Đề xuất bổ sung trưng bày.', 30, 'Global contextual template', '{"seed":"phase_6"}'::jsonb)
on conflict (id) do nothing;

insert into public.mcp_competitors (id, competitor_name, category, status, sort_order, note, raw_payload)
values
  ('mc_global_direct_competitor', 'Đối thủ trực tiếp', 'general', 'active', 10, 'Option global để sale chọn nhanh khi chưa có master đối thủ chi tiết.', '{"seed":"phase_6"}'::jsonb),
  ('mc_global_low_price_competitor', 'Đối thủ giá thấp', 'price', 'active', 20, 'Option global để ghi nhận đối thủ cạnh tranh bằng giá.', '{"seed":"phase_6"}'::jsonb),
  ('mc_global_local_competitor', 'Đối thủ địa phương', 'local', 'active', 30, 'Option global để ghi nhận thương hiệu địa phương.', '{"seed":"phase_6"}'::jsonb)
on conflict (id) do nothing;
