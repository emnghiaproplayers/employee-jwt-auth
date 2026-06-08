import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeService } from './employee.service';
import { Employee } from './employee.entity';

describe('EmployeeService', () => {
  let service: EmployeeService;
  let repository: Repository<Employee>;

  const mockEmployeeRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        {
          provide: getRepositoryToken(Employee),
          useValue: mockEmployeeRepository,
        },
      ],
    }).compile();

    service = module.get<EmployeeService>(EmployeeService);
    repository = module.get<Repository<Employee>>(getRepositoryToken(Employee));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOneByEmail', () => {
    it('should call findOne with correct email', async () => {
      const email = 'test@company.com';
      mockEmployeeRepository.findOne.mockResolvedValue({ id: 'uuid', email });

      const result = await service.findOneByEmail(email);

      expect(mockEmployeeRepository.findOne).toHaveBeenCalledWith({
        where: { email },
      });
      expect(result).toEqual({ id: 'uuid', email });
    });
  });
});
