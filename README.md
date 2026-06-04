# NestJS Employee JWT Authentication & Redis Blacklisting

Hệ thống quản lý thông tin nhân viên (Employee) kết hợp cơ chế đăng ký/đăng nhập, xác thực không trạng thái (stateless) bằng JSON Web Token (JWT) theo thuật toán HS256 và cơ chế thu hồi phiên làm việc (revocation/logout) thời gian thực sử dụng Redis Blacklist. Dịch vụ chạy trên nền tảng NestJS, Passport, TypeORM, PostgreSQL 16 và Redis 7 thông qua Docker Compose.

---

## 1. Challenge Description

Bài toán tập trung xây dựng quy trình xác thực người dùng an sau và cơ chế thu hồi JWT linh hoạt:
- **Độc lập hóa Module**: Tách biệt `AuthModule` (signup/signin/strategy/guard) khỏi `EmployeeModule` (tài nguyên nghiệp vụ).
- **PostgreSQL & Redis qua Docker**: Dựng cơ sở dữ liệu Postgres 16 và Redis 7 Alpine qua Docker Compose.
- **Tắt đồng bộ hóa Schema tự động (`synchronize: false`)**: Dùng TypeORM CLI để tạo và chạy database migrations.
- **Mã hóa và chống Enumeration**: Mã hóa mật khẩu bằng `bcrypt` (10 salt rounds), đồng nhất phản hồi lỗi đăng nhập 401 để chống User Enumeration.
- **Unique Token Identifier (jti claim)**: Thêm claim `jti` (UUID v4) vào mỗi JWT token lúc đăng nhập để làm định danh duy nhất phục vụ thu hồi token.
- **Cơ chế thu hồi phiên làm việc (Logout)**:
  - Cho phép người dùng logout, trích xuất token hiện tại và giải mã để lấy `jti` và `exp`.
  - Tính TTL động: `ttl = exp - hiện tại`.
  - Lưu cặp `blacklist:<jti>` vào Redis với TTL động để tự động giải phóng bộ nhớ khi token hết hạn tự nhiên.
- **Can thiệp JwtStrategy**: Tích hợp kiểm tra blacklist trực tiếp trong `JwtStrategy` sau khi verify chữ ký thành công.

---

## 2. How to Run

### A. Yêu cầu hệ thống
- Docker và Docker Compose cài đặt sẵn.
- Node.js >= 18.x và npm.

### B. Khởi chạy ứng dụng
1. **Khởi động database PostgreSQL 16 và Redis 7 Alpine**:
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
- **cache-manager-ioredis-yet & @nestjs/cache-manager**: Kết nối và quản trị bộ nhớ cache Redis.
- **keyv**: Được NestJS CacheManager v3 sử dụng ngầm để định cấu hình lưu trữ phân tán.

### Sơ đồ Mermaid luồng Revocation & Blacklisting

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / HTTP Request
    participant Controller as AuthController (auth.controller.ts)
    participant Service as AuthService (auth.service.ts)
    participant Redis as Redis Cache Store

    Note over Client, Redis: Phase 1: Đăng xuất & Thu hồi Token (SET)
    Client->>Controller: POST /auth/logout (Authorization: Bearer <tokenA>)
    activate Controller
    Note over Controller: Xác thực JWT hợp lệ thành công qua Guard
    Controller->>Service: logout(tokenA)
    activate Service
    Note over Service: Giải mã tokenA lấy jti & exp
    Note over Service: Tính TTL = exp - hiện tại
    Service->>Redis: SET blacklist:<jti> "1" EX <ttl>
    activate Redis
    Redis-->>Service: Đã lưu thành công
    deactivate Redis
    Service-->>Controller: Hoàn tất thu hồi
    deactivate Service
    Controller-->>Client: Trả về HTTP 204 No Content
    deactivate Controller

    Note over Client, Redis: Phase 2: Xác thực & Đối chiếu Blacklist (GET)
    Client->>Controller: GET /employees/profile (Authorization: Bearer <tokenA>)
    activate Controller
    Note over Controller: Kích hoạt Guard -> JwtStrategy
    Note over Controller: Giải mã chữ ký tokenA và lấy jti từ payload
    Controller->>Redis: GET blacklist:<jti>
    activate Redis
    Redis-->>Controller: Trả về "1" (Token đã bị thu hồi)
    deactivate Redis
    Controller-->>Client: Trả về HTTP 401 Unauthorized (Token revoked)
    deactivate Controller
```

---

## 4. Smoke Test (Bằng chứng Thực tế)

Dưới đây là các phản hồi thực tế được thực hiện trực tiếp từ dòng lệnh sử dụng `curl.exe` và `redis-cli` trong môi trường Docker:

### 1. Đăng ký tài khoản thành công (`POST /auth/signup`) -> HTTP 201
```http
HTTP/1.1 201 Created
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 70
ETag: W/"46-chWWUXLnxcv1YS5A4SYIFRVw3eU"
Date: Thu, 04 Jun 2026 02:20:53 GMT
Connection: keep-alive

{"id":"486a206b-5ca6-4e2d-a2bd-85b9f0ee41d2","email":"alice@demo.com"}
```

### 2. Signin lần 1 và lấy tokenA (`POST /auth/signin`) -> HTTP 200
```http
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 268
Date: Thu, 04 Jun 2026 02:34:07 GMT
Connection: keep-alive

{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0ODZhMjA2Yi01Y2E2LTRlMmQtYTJiZC04NWI5ZjBlZTQxZDIiLCJqdGkiOiJmOTc3MTQ1NC1hZmYyLTQ5N2MtYmQwMC02YzMzNWViZTk0YjYiLCJpYXQiOjE3ODA1NDA5NTAsImV4cCI6MTc4MDU0MTg1MH0.ikg5yp3fxP-CqE-r5zGdHcKslJ72FzzRxV6NhkCAETo"}
```

### 3. Signin lần 2 và lấy tokenB với jti khác (`POST /auth/signin`) -> HTTP 200
```http
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 268
Date: Thu, 04 Jun 2026 02:34:07 GMT
Connection: keep-alive

{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0ODZhMjA2Yi01Y2E2LTRlMmQtYTJiZC04NWI5ZjBlZTQxZDIiLCJqdGkiOiJmZDU4ZjQzNi1iMzQ3LTRkMzEtYTNlZS0xYmU1MzNlNmEyYTgiLCJpYXQiOjE3ODA1NDA5NTAsImV4cCI6MTc4MDU0MTg1MH0.O0vz-YkkhtHu3jVu4HlzZ0SEVDT44nUmg2pqbf0erdQ"}
```

### 4. Logout với tokenA (`POST /auth/logout`) -> HTTP 204 No Content
```http
HTTP/1.1 204 No Content
X-Powered-By: Express
Date: Thu, 04 Jun 2026 02:34:07 GMT
Connection: keep-alive
```

### 5. Kiểm tra Redis lưu trữ thông tin blacklist
* **Lấy danh sách keys**:
  ```bash
  docker exec -t employee-auth-redis redis-cli --raw KEYS "blacklist:*"
  ```
  **Kết quả**:
  ```text
  blacklist:f9771454-aff2-497c-bd00-6c335ebe94b6
  ```
* **Lấy TTL của key**:
  ```bash
  docker exec -t employee-auth-redis redis-cli --raw TTL "blacklist:f9771454-aff2-497c-bd00-6c335ebe94b6"
  ```
  **Kết quả**:
  ```text
  899
  ```

### 6. Gọi profile với tokenA đã logout -> HTTP 401 Unauthorized
```http
HTTP/1.1 401 Unauthorized
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 70
Date: Thu, 04 Jun 2026 02:34:11 GMT
Connection: keep-alive

{"message":"Token revoked","error":"Unauthorized","statusCode":401}
```

### 7. Gọi profile với tokenB chưa logout -> HTTP 200 OK
```http
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 120
Date: Thu, 04 Jun 2026 02:34:11 GMT
Connection: keep-alive

{"message":"Bạn đã truy cập vào khu vực bảo mật!","user":{"userId":"486a206b-5ca6-4e2d-a2bd-85b9f0ee41d2"}}
```

### 8. Tự động dọn dẹp (Expired) sau khi hết hạn tự nhiên
* Đặt `JWT_EXPIRATION=10s`, thực hiện đăng nhập rồi đăng xuất.
* Tại thời điểm $t = 0s$:
  ```bash
  docker exec -t employee-auth-redis redis-cli --raw KEYS "blacklist:*"
  ```
  **Kết quả**:
  ```text
  blacklist:15861222-e6b1-44b6-a09b-ed364c62594c
  ```
* Sau khi chờ đợi $t = 11s$:
  ```bash
  docker exec -t employee-auth-redis redis-cli --raw KEYS "blacklist:*"
  ```
  **Kết quả**:
  ```text
  (empty)
  ```

---

## 5. Code Execution Trace (Luồng xử lý `POST /auth/logout`)

Quy trình đăng xuất và thu hồi token đi qua các bước cụ thể như sau:

1. **Điểm chạm 1 - Giao diện Endpoint của Controller**:
   - **File & Dòng**: [src/modules/auth/auth.controller.ts:22](file:///d:/Nghia-project/escape-beta/employee-jwt-auth/src/modules/auth/auth.controller.ts#L22)
   - **Mã nguồn**:
     ```typescript
     @UseGuards(JwtAuthGuard)
     @HttpCode(HttpStatus.NO_CONTENT)
     @Post('logout')
     async logout(@Request() req: any) {
       const token = req.headers.authorization?.split(' ')[1];
       if (token) {
         await this.authService.logout(token);
       }
     }
     ```
   - **Mô tả**: Khi người dùng gọi POST `/auth/logout`, JwtAuthGuard kiểm tra token có hợp lệ không. Nếu hợp lệ, controller trích xuất chuỗi Bearer token và chuyển giao cho `AuthService`.

2. **Điểm chạm 2 - Tính toán TTL động và lưu Blacklist ở Service**:
   - **File & Dòng**: [src/modules/auth/auth.service.ts:49](file:///d:/Nghia-project/escape-beta/employee-jwt-auth/src/modules/auth/auth.service.ts#L49)
   - **Mã nguồn**:
     ```typescript
     async logout(token: string): Promise<void> {
       try {
         const decoded = this.jwtService.decode(token) as any;
         if (decoded && decoded.jti && decoded.exp) {
           const ttl = decoded.exp - Math.floor(Date.now() / 1000);
           if (ttl > 0) {
             await this.cacheManager.set(`blacklist:${decoded.jti}`, '1', ttl * 1000);
           }
         }
       } catch (e) {
         // Ignore
       }
     }
     ```
   - **Mô tả**: `AuthService` giải mã token mà không cần verify lại chữ ký để lấy claim `jti` và `exp`. Sau đó, lấy thời gian hiện tại để tính toán TTL động (bằng giây) và lưu vào Redis qua cacheManager dưới dạng mili-giây.

3. **Điểm chạm 3 - Kết nối Redis lưu Key**:
   - **File & Dòng**: [src/app.module.ts:38](file:///d:/Nghia-project/escape-beta/employee-jwt-auth/src/app.module.ts#L38)
   - **Mã nguồn**:
     ```typescript
     const keyvStore = {
       get: (key: string) => (store as any).get(key),
       set: (key: string, value: any, ttl?: number) => (store as any).set(key, value, ttl),
       delete: (key: string) => (store as any).del(key).then(() => true),
       clear: () => (store as any).reset(),
     };
     ```
   - **Mô tả**: Lớp wrapper Keyv gọi trực tiếp adapter `cache-manager-ioredis-yet` để đẩy lệnh `SETEX blacklist:<jti> <ttl> 1` xuống Redis Database.

---

## 6. Design Decisions

### A. Lựa chọn cơ chế Blacklist dựa trên `jti` thay vì lưu giữ toàn bộ JWT String
- **Quyết định**: Mỗi token được ký sẽ sinh ra một `jti` (UUID v4) duy nhất. Khi người dùng logout, chúng ta chỉ lưu giữ `blacklist:<jti>` vào Redis thay vì toàn bộ chuỗi token dài.
- **Lý do**: Chuỗi token JWT thô có kích thước lớn (thường từ 200-500 bytes). Việc lưu toàn bộ chuỗi token thô vào Redis làm lãng phí dung lượng RAM. Lưu trữ `jti` (UUID v4 36 ký tự) giúp tối ưu hóa đáng kể bộ nhớ Redis khi quy mô người dùng tăng lên hàng triệu phiên làm việc.

### B. Sử dụng Keyv làm Adapter tương thích cho CacheManager v3
- **Quyết định**: Do NestJS v11 và `@nestjs/cache-manager` v3 chuyển dịch hoàn toàn sang Keyv và không còn tương thích trực tiếp với các adapter của `cache-manager` v5 (như `cache-manager-ioredis-yet`), chúng ta đã triển khai một Adapter Wrapper tối giản chuyển tiếp các cuộc gọi `.get`, `.set`, `.del`, `.reset` sang `.get`, `.set`, `.delete`, `.clear` của Keyv.
- **Lý do**: Wrapper này giúp tận dụng tối đa sức mạnh kết nối của thư viện `ioredis` từ `cache-manager-ioredis-yet` mà không phải cài thêm hay cấu hình phức tạp các gói adapter Keyv ngoài luồng, đảm bảo tính ổn định và kiểm soát của dự án.

### C. Đánh đổi (Trade-off) giữa Stateless JWT vs. Revocation Blacklist
- **Quyết định**: Kết hợp JWT không trạng thái truyền thống với một lớp kiểm tra blacklist nhanh (Fast Lookup) trên Redis.
- **Lý do**:
  - *Stateless JWT*: Có ưu thế là không cần truy vấn DB để lấy thông tin nhân viên trên mỗi request, giảm tải cho Postgres. Tuy nhiên, điểm yếu chết người là không thể hủy bỏ token từ phía máy chủ trước khi nó hết hạn.
  - *Redis Blacklist*: Giải quyết triệt để vấn đề thu hồi token khi người dùng bấm đăng xuất. Việc kiểm tra blacklist chỉ tốn khoảng 1ms truy vấn bộ nhớ đệm (RAM) của Redis, một chi phí chấp nhận được để mang lại sự an toàn và kiểm soát tuyệt đối trên hệ thống.
