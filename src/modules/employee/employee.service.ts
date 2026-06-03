import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './employee.entity';

@Injectable()
export class EmployeeService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
  ) {}

  async findOneByEmail(email: string): Promise<Employee | null> {
    return this.employeeRepository.findOne({ where: { email } });
  }

  async findOneById(id: string): Promise<Employee | null> {
    return this.employeeRepository.findOne({ where: { id } });
  }

  async create(email: string, passwordHash: string): Promise<Employee> {
    const employee = this.employeeRepository.create({
      email,
      passwordHash,
    });
    return this.employeeRepository.save(employee);
  }
}
