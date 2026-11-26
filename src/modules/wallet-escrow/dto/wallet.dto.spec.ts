import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TopUpDto } from './wallet.dto';

describe('TopUpDto exact Toman amounts', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const transform = (amount: unknown): Promise<TopUpDto> => pipe.transform(
    { amount, idempotencyKey: 'test-topup-001' },
    { type: 'body', metatype: TopUpDto },
  );

  it('preserves canonical integer strings above Number.MAX_SAFE_INTEGER', async () => {
    await expect(transform('9007199254740993')).resolves.toMatchObject({ amount: '9007199254740993' });
  });

  it('accepts existing safe integer amounts', async () => {
    await expect(transform(23_400)).resolves.toMatchObject({ amount: '23400' });
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, '1.5', '-7', '0', '4e2'])('rejects ambiguous or nonpositive Toman input %s', async (amount) => {
    await expect(transform(amount)).rejects.toThrow(BadRequestException);
  });
});
