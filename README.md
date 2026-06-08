# Cinema RBAC & Multi-Device Session Management

Hệ thống quản lý xác thực người dùng sử dụng JSON Web Token (JWT) tích hợp mô hình **Multi-Device Sessions** (Refresh Token Rotation) và kiểm soát truy cập dựa trên vai trò (**Role-Based Access Control - RBAC**).

---

## 1. Challenge description

Thử thách yêu cầu thiết kế hệ thống phân quyền (RBAC) phân biệt vai trò cho các endpoint rạp chiếu phim (Cinema) với hai vai trò chính: `MANAGER` và `STAFF`.
- Phân tách phân hệ Authentication (Xác thực - `JwtAuthGuard`) và Authorization (Ủy quyền - `RolesGuard`).
- Định nghĩa custom decorator `@Roles()` để cấu hình vai trò được truy cập.
- Định nghĩa custom decorator `@Public()` để cho phép bỏ qua xác thực ở một số route công khai.
- Sử dụng `Reflector.getAllAndOverride` để hỗ trợ cơ chế ghi đè metadata cấp độ Handler so với Class, và thực thi logic phân quyền với quan hệ OR (nhiều vai trò cùng được phép truy cập).

---

## 2. How to run

1. **Khởi động các dịch vụ phụ trợ (PostgreSQL & Redis)** thông qua Docker Compose:
   ```bash
   docker compose up -d
   ```
2. **Khởi chạy ứng dụng NestJS ở chế độ phát triển**:
   ```bash
   npm run start:dev
   ```
3. **Chạy các bài kiểm thử tự động (E2E Tests)** để xác minh toàn bộ luồng Auth & RBAC hoạt động chính xác:
   ```bash
   npm run test:e2e
   ```

---

## 3. Architecture/Stack

- **Framework**: NestJS (v11+)
- **Ngôn ngữ**: TypeScript
- **Database / ORM**: PostgreSQL & TypeORM
- **Caching / Blacklist**: Redis & Cache Manager
- **Bảo mật / Phân quyền**: Passport.js (JWT), custom Decorators (`@Roles`, `@Public`) & Guards (`JwtAuthGuard`, `RolesGuard`)

### Sơ đồ cấu trúc thư mục chính:
- `src/common/role.enum.ts`: Định nghĩa vai trò `MANAGER` và `STAFF`.
- `src/entities/postgresql/main/user.entity.ts`: Thực thể `UserEntity` lưu trữ người dùng và vai trò.
- `src/common/decorators/`: Chứa custom `@Roles()` và `@Public()`.
- `src/common/guards/roles.guard.ts`: `RolesGuard` kiểm tra quyền dựa trên metadata và `req.user.role`.
- `src/modules/cinema/cinema.controller.ts`: Các endpoints quản lý lịch chiếu, báo cáo và vé.

---

## 4. Smoke Test

Dưới đây là kết quả kiểm thử thực tế (Status + Response Headers + Body) từ terminal cho 3 luồng hoạt động chính:

### Luồng 1: STAFF truy cập báo cáo của MANAGER (Expect: HTTP 403 Forbidden)
```http
HTTP/1.1 403 Forbidden
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 69
ETag: W/"45-MZJWZc+Y+RUbHpnhz2B2Vipii24"
Date: Sun, 07 Jun 2026 09:54:26 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"message":"Forbidden resource","error":"Forbidden","statusCode":403}
```

### Luồng 2: MANAGER truy cập báo cáo của MANAGER (Expect: HTTP 200 OK)
```http
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 42
ETag: W/"2a-57ecyYO2QtEdwACrXdL6pz5M0ZI"
Date: Sun, 07 Jun 2026 09:54:41 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"revenue":150000000,"period":"June 2026"}
```

### Luồng 3: Người dùng công khai truy cập lịch chiếu không cần Token (Expect: HTTP 200 OK)
```http
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 100
ETag: W/"64-WO5rVq5B6MTTyp7F44XmllMDz/o"
Date: Sun, 07 Jun 2026 09:55:22 GMT
Connection: keep-alive
Keep-Alive: timeout=5

[{"id":1,"movie":"Avengers: Secret Wars","time":"18:00"},{"id":2,"movie":"Avatar 3","time":"21:00"}]
```

---

## 5. Code Execution Trace

Luồng đi của request đối với endpoint yêu cầu vai trò Manager (`/cinema/manager/reports`) đi qua các file và dòng code sau:

1. **Xác thực JWT**: `src/modules/auth/jwt-auth.guard.ts:12 -> JwtAuthGuard.canActivate()`
   - Trích xuất token từ Authorization Header, kiểm tra tính hợp lệ và giải mã payload để đưa thông tin user (`{ userId, role }`) vào `req.user`.
2. **Kiểm tra phân quyền**: `src/common/guards/roles.guard.ts:10 -> RolesGuard.canActivate()`
   - Đọc danh sách vai trò yêu cầu (`[Role.MANAGER]`) bằng `Reflector.getAllAndOverride`, so khớp với `user.role` từ request để ra quyết định đi tiếp hay từ chối.
3. **Thực thi Controller**: `src/modules/cinema/cinema.controller.ts:13 -> CinemaController.getReports()`
   - Trả về kết quả báo cáo khi cả hai guard trước đó đều cho phép đi qua.

---

## 6. Design Decisions

### A. Phân tách `JwtAuthGuard` và `RolesGuard` độc lập
- **Tại sao?** Việc phân tách này tuân thủ nguyên lý Single Responsibility (Đơn nhiệm). `JwtAuthGuard` chỉ chịu trách nhiệm **Authentication** (Xác định bạn là ai - bằng cách xác thực chữ ký JWT). `RolesGuard` chỉ chịu trách nhiệm **Authorization** (Xác định bạn có được phép làm việc này không - bằng cách so sánh vai trò của bạn với metadata).
- **Thứ tự chạy**: `JwtAuthGuard` bắt buộc phải chạy trước `RolesGuard` trong chuỗi `@UseGuards(JwtAuthGuard, RolesGuard)` vì `RolesGuard` phụ thuộc hoàn toàn vào đối tượng `req.user` đã được `JwtAuthGuard` xác thực và gán vào request.

### B. Lưu trữ `role` trong JWT vs Truy vấn cơ sở dữ liệu (Database Query)
- **Phương án 1 (Đã chọn): Đưa claim `role` vào JWT**
  - *Ưu điểm*: Tối ưu hóa hiệu năng cực lớn. `RolesGuard` có thể lấy trực tiếp vai trò của người dùng từ token mà không cần thực hiện thêm bất kỳ truy vấn SQL nào đến DB ở mỗi request.
  - *Nhược điểm*: Khi quản trị viên thay đổi vai trò của một người dùng trong cơ sở dữ liệu, vai trò cũ vẫn có hiệu lực cho đến khi Access Token hết hạn (khoảng 15 phút).
- **Phương án 2: Truy vấn cơ sở dữ liệu ở mỗi request**
  - *Ưu điểm*: Đảm bảo tính thời gian thực (real-time). Bất kỳ thay đổi vai trò nào trên DB cũng có hiệu lực ngay lập tức.
  - *Nhược điểm*: Gây nghẽn cổ chai cho database (DB bottleneck) dưới tải lớn do phải liên tục thực hiện truy vấn SELECT cho mọi HTTP request.
