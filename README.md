# NestJS Employee JWT Authentication & Security API

Hệ thống quản lý thông tin nhân viên (Employee) kết hợp cơ chế đăng ký/đăng nhập và xác thực không trạng thái (stateless) bằng JSON Web Token (JWT) theo thuật toán mã hóa đối xứng HS256, sử dụng NestJS, Passport, TypeORM và PostgreSQL 16 chạy trong Docker.

---

## 1. Challenge Description

Bài toán tập trung thiết lập quy trình xác thực người dùng an toàn và chuẩn hóa dữ liệu:
- **Độc lập hóa Module**: Tách biệt `AuthModule` (xử lý signup/signin/strategy/guard) khỏi `EmployeeModule` (xử lý tài nguyên nghiệp vụ của nhân viên).
- **PostgreSQL qua Docker**: Triển khai database qua Docker Compose với Postgres phiên bản 16.
- **Tắt đồng bộ hóa Schema tự động (`synchronize: false`)**: Dùng TypeORM CLI để tạo và chạy database migrations nhằm duy trì và bảo vệ tính toàn vẹn của dữ liệu ở mọi môi trường.
- **Mã hóa và chống Enumeration**:
  - Mã hóa mật khẩu nhân viên bằng `bcrypt` với độ muối (salt rounds) là 10.
  - Thu gọn và đồng nhất phản hồi lỗi đăng nhập 401 khi sai mật khẩu hoặc tài khoản không tồn tại để ngăn chặn nguy cơ rò rỉ dữ liệu người dùng (anti-user enumeration).
  - Trả về token định dạng snake_case `access_token` chứa tối thiểu thông tin định danh (chỉ chứa `sub: user.id`).
- **Bảo vệ Endpoint**: Sử dụng `JwtAuthGuard` và `JwtStrategy` kế thừa Passport để bảo vệ nghiêm ngặt đường dẫn protected `GET /employees/profile`.

---

## 2. How to Run

### A. Yêu cầu hệ thống
- Docker và Docker Compose cài đặt sẵn.
- Node.js >= 18.x và npm.

### B. Khởi chạy và Dựng dữ liệu
1. **Khởi động database PostgreSQL 16 container**:
   ```bash
   docker compose up -d
   ```
2. **Chạy migrations tạo cấu trúc bảng `employees`**:
   ```bash
   npm run migration:run
   ```
3. **Khởi chạy máy chủ NestJS**:
   ```bash
   npm run start
   ```

### C. Chạy bộ kiểm thử tự động
- **Chạy E2E Tests**:
  ```bash
  npm run test:e2e
  ```
- **Chạy Unit Tests**:
  ```bash
  npm run test
  ```

---

## 3. Architecture & Stack

Dự án được xây dựng dựa trên:
- **NestJS v11.x**, **TypeScript v5.7**, **TypeORM**, **Postgres driver (`pg`)**.
- **@nestjs/passport & passport-jwt**: Xử lý middleware xác thực.
- **bcrypt**: Mã hóa một chiều mật khẩu.

### Sơ đồ luồng hoạt động xác thực Profile (Mermaid Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / HTTP Request
    participant Guard as JwtAuthGuard (jwt-auth.guard.ts)
    participant Strategy as JwtStrategy (jwt.strategy.ts)
    participant Controller as EmployeeController (employee.controller.ts)
    participant DB as Postgres Database

    Client->>Guard: GET /employees/profile (Authorization: Bearer <token>)
    activate Guard
    Note over Guard: Kích hoạt canActivate()
    Guard->>Strategy: Chuyển tiếp Token để giải mã
    activate Strategy
    Note over Strategy: Kiểm tra chữ ký HS256 & Expired
    alt Token hợp lệ
        Strategy->>Strategy: Gọi validate(payload)
        Note over Strategy: Trả về { userId: payload.sub }
        Strategy-->>Guard: Xác thực thành công
        Guard->>Controller: Cho phép truy cập (req.user = { userId })
        activate Controller
        Controller-->>Client: Trả về 200 OK { message, user: { userId } }
        deactivate Controller
    else Token thiếu / Sai chữ ký / Hết hạn
        Strategy-->>Guard: Lỗi xác thực
        deactivate Strategy
        Guard-->>Client: Trả về HTTP 401 Unauthorized
        deactivate Guard
    end
```

---

## 4. Smoke Test (Bằng chứng Thực tế)

Dưới đây là các phản hồi thực tế được thực hiện trực tiếp từ dòng lệnh sử dụng `curl.exe` gửi tới NestJS server:

### Case 1: Đăng ký tài khoản thành công (`POST /auth/signup`) -> HTTP 201 Created
- **Lệnh gửi (Request)**:
  ```bash
  curl.exe -i -X POST http://localhost:3000/auth/signup -H "Content-Type: application/json" -d "{\"email\":\"alice@demo.com\",\"password\":\"secret123\"}"
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 201 Created
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 70
  ETag: W/"46-chWWUXLnxcv1YS5A4SYIFRVw3eU"
  Date: Wed, 03 Jun 2026 20:44:23 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"id":"15b30443-b26a-4411-9140-377188d12c34","email":"alice@demo.com"}
  ```

### Case 2: Đăng ký thất bại do trùng lặp email (`POST /auth/signup`) -> HTTP 409 Conflict
- **Lệnh gửi (Request)**:
  ```bash
  curl.exe -i -X POST http://localhost:3000/auth/signup -H "Content-Type: application/json" -d "{\"email\":\"alice@demo.com\",\"password\":\"secret123\"}"
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 409 Conflict
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 70
  ETag: W/"46-Fqi7MW8UTTNsiOC7lI+OJ4Fodz4"
  Date: Wed, 03 Jun 2026 20:46:23 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"message":"Email already in use","error":"Conflict","statusCode":409}
  ```

### Case 3: Đăng nhập thành công và lấy JWT (`POST /auth/signin`) -> HTTP 200 OK
- **Lệnh gửi (Request)**:
  ```bash
  curl.exe -i -X POST http://localhost:3000/auth/signin -H "Content-Type: application/json" -d "{\"email\":\"alice@demo.com\",\"password\":\"secret123\"}"
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 200 OK
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 207
  ETag: W/"cf-8FDnj6ZnY4uRYtTL9MNrzbLr1kE"
  Date: Wed, 03 Jun 2026 20:44:50 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNWIzMDQ0My1iMjZhLTQ0MTEtOTE0MC0zNzcxODhkMTJjMzQiLCJpYXQiOjE3ODA1MTk0OTAsImV4cCI6MTc4MDUyMDM5MH0.d_SU-lxV1THVjbA758PhJlbnP7vASStIeCVFftzlaoE"}
  ```

### Case 4: Đăng nhập thất bại do sai tài khoản / mật khẩu (`POST /auth/signin`) -> HTTP 401 Unauthorized
- **Lệnh gửi (Request)**:
  ```bash
  curl.exe -i -X POST http://localhost:3000/auth/signin -H "Content-Type: application/json" -d "{\"email\":\"alice@demo.com\",\"password\":\"wrongpassword\"}"
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 401 Unauthorized
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 73
  ETag: W/"49-Fx+yDPXfDSYD3nxIxyU6P47CVX0"
  Date: Wed, 03 Jun 2026 20:46:35 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"message":"Invalid credentials","error":"Unauthorized","statusCode":401}
  ```

### Case 5: Truy cập hồ sơ có Token hợp lệ (`GET /employees/profile`) -> HTTP 200 OK
- **Lệnh gửi (Request)**:
  ```bash
  curl.exe -i http://localhost:3000/employees/profile -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNWIzMDQ0My1iMjZhLTQ0MTEtOTE0MC0zNzcxODhkMTJjMzQiLCJpYXQiOjE3ODA1MTk0OTAsImV4cCI6MTc4MDUyMDM5MH0.d_SU-lxV1THVjbA758PhJlbnP7vASStIeCVFftzlaoE"
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 200 OK
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 120
  ETag: W/"78-sDeozmru+wPGXl3uVyiUBkL7QDk"
  Date: Wed, 03 Jun 2026 20:45:20 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"message":"Bạn đã truy cập vào khu vực bảo mật!","user":{"userId":"15b30443-b26a-4411-9140-377188d12c34"}}
  ```

### Case 6: Truy cập hồ sơ thiếu Token (`GET /employees/profile`) -> HTTP 401 Unauthorized
- **Lệnh gửi (Request)**:
  ```bash
  curl.exe -i http://localhost:3000/employees/profile
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 401 Unauthorized
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 43
  ETag: W/"2b-dGnJzt6gv1nJjX6DJ9RztDWptng"
  Date: Wed, 03 Jun 2026 20:45:43 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"message":"Unauthorized","statusCode":401}
  ```

### Case 7: Truy cập hồ sơ với Token có Signature sai (`GET /employees/profile`) -> HTTP 401 Unauthorized
- **Lệnh gửi (Request - Thay đổi chữ cái cuối cùng từ eE sang eF)**:
  ```bash
  curl.exe -i http://localhost:3000/employees/profile -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNWIzMDQ0My1iMjZhLTQ0MTEtOTE0MC0zNzcxODhkMTJjMzQiLCJpYXQiOjE3ODA1MTk0OTAsImV4cCI6MTc4MDUyMDM5MH0.d_SU-lxV1THVjbA758PhJlbnP7vASStIeCVFftzlaoF"
  ```
- **Phản hồi nhận về (Response)**:
  ```http
  HTTP/1.1 401 Unauthorized
  X-Powered-By: Express
  Content-Type: application/json; charset=utf-8
  Content-Length: 43
  ETag: W/"2b-dGnJzt6gv1nJjX6DJ9RztDWptng"
  Date: Wed, 03 Jun 2026 20:46:07 GMT
  Connection: keep-alive
  Keep-Alive: timeout=5

  {"message":"Unauthorized","statusCode":401}
  ```

---

## 5. Code Execution Trace (Luồng xử lý `GET /employees/profile`)

Quy trình xác thực yêu cầu hồ sơ của nhân viên đi qua 3 điểm chạm then chốt sau:

1. **Điểm chạm 1 - Giao diện Endpoint bảo vệ**:
   - **File & Dòng**: [src/modules/employee/employee.controller.ts:11](file:///d:/Nghia-project/escape-beta/employee-jwt-auth/src/modules/employee/employee.controller.ts#L11)
   - **Mã nguồn**:
     ```typescript
     @UseGuards(JwtAuthGuard)
     @Get('profile')
     async getProfile(@Request() req: any)
     ```
   - **Mô tả**: Khi request được gửi đến, NestJS chặn lại thông qua `@UseGuards(JwtAuthGuard)` để bắt đầu quy trình kiểm tra Token.

2. **Điểm chạm 2 - Kích hoạt Guard xác thực JWT**:
   - **File & Dòng**: [src/modules/auth/jwt-auth.guard.ts:4](file:///d:/Nghia-project/escape-beta/employee-jwt-auth/src/modules/auth/jwt-auth.guard.ts#L4)
   - **Mã nguồn**:
     ```typescript
     @Injectable()
     export class JwtAuthGuard extends AuthGuard('jwt') {}
     ```
   - **Mô tả**: Lớp Guard kích hoạt cơ chế canActivate của Passport, bắt buộc trích xuất chuỗi Bearer token từ tiêu đề `Authorization` của HTTP Header.

3. **Điểm chạm 3 - So khớp chữ ký và giải mã Claims**:
   - **File & Dòng**: [src/modules/auth/jwt.strategy.ts:16](file:///d:/Nghia-project/escape-beta/employee-jwt-auth/src/modules/auth/jwt.strategy.ts#L16)
   - **Mã nguồn**:
     ```typescript
     async validate(payload: any) {
       return { userId: payload.sub };
     }
     ```
   - **Mô tả**: Sau khi giải mã thành công bằng thuật toán HS256 với secret key, JwtStrategy giải nén payload, lấy `sub` ánh xạ thành thuộc tính `userId` và gán lại cho Request tại `req.user.userId`. Sau đó cho phép chuyển tiếp request tới hàm `getProfile` của Controller.

---

## 6. Design Decisions

### A. Sử dụng database PostgreSQL 16 qua Docker Compose
- **Quyết định**: Đóng gói môi trường cơ sở dữ liệu Postgres 16 nhằm đồng nhất cấu hình chạy ứng dụng ở mọi máy phát triển.
- **Lý do**: Triển khai Postgres qua Docker tránh được việc xung đột dịch vụ Postgres cài đặt sẵn trên máy host, đồng thời giúp dễ dàng quản trị dữ liệu thông qua Volume Mount độc lập.

### B. Tắt tính năng tự động đồng bộ DB schema (`synchronize: false`)
- **Quyết định**: Khóa tính năng tự động cập nhật bảng của TypeORM trên toàn bộ môi trường và bắt buộc tạo Schema qua tệp migration.
- **Lý do**: Tính năng `synchronize: true` vô cùng nguy hiểm, có thể dẫn đến việc drop mất dữ liệu khi thay đổi code entity (VD: đổi tên cột). Dùng migration ghi lại lịch sử SQL vừa giúp quản trị cấu trúc vừa an toàn tuyệt đối cho môi trường Production.

### C. Triển khai Cơ chế Chống Dò Quét Tài Khoản (Anti-user Enumeration)
- **Quyết định**: Khi đăng nhập thất bại, hệ thống phản hồi duy nhất một mã trạng thái 401 Unauthorized kèm theo nội dung `Invalid credentials` bất kể lỗi do sai mật khẩu hay email không tồn tại. Đồng thời, chạy dummy bcrypt so khớp nếu không tìm thấy user.
- **Lý do**: Nếu phản hồi lỗi khác nhau (ví dụ: "Email không tồn tại" hoặc "Sai mật khẩu"), kẻ tấn công có thể viết script dò tìm danh sách tất cả các email đã đăng ký thành công trên hệ thống. Đồng nhất phản hồi và thời gian phản hồi giúp triệt tiêu hoàn toàn lỗ hổng bảo mật này.

### D. Tách biệt `AuthModule` và `EmployeeModule`
- **Quyết định**: Xây dựng hai module hoạt động hoàn toàn độc lập, chỉ liên kết qua Dependency Injection của NestJS.
- **Lý do**: Tách biệt luồng xử lý giúp dễ dàng mở rộng và bảo trì. `AuthModule` đóng vai trò cổng bảo mật, trong khi `EmployeeModule` chứa các logic nghiệp vụ lõi về nhân viên.
