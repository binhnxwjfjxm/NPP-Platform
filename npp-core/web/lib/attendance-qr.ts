const SIZE = 33;
const DATA_CODEWORDS = 64;
const ECC_PER_BLOCK = 18;
const BLOCKS = 2;
const MAX_PAYLOAD_BYTES = 62;

function appendBits(bits: number[], value: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
}

function gfMultiply(left: number, right: number) {
  let result = 0;
  let a = left;
  let b = right;
  while (b) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

function reedSolomonGenerator(degree: number) {
  let generator = [1];
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(generator.length + 1).fill(0);
    for (let item = 0; item < generator.length; item += 1) {
      next[item] ^= generator[item];
      next[item + 1] ^= gfMultiply(generator[item], root);
    }
    generator = next;
    root = gfMultiply(root, 2);
  }
  return generator;
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = reedSolomonGenerator(degree);
  const remainder = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    for (let index = 0; index < degree - 1; index += 1) remainder[index] = remainder[index + 1];
    remainder[degree - 1] = 0;
    for (let index = 0; index < degree; index += 1) {
      remainder[index] ^= gfMultiply(generator[index + 1], factor);
    }
  }
  return remainder;
}

function dataCodewords(payload: string) {
  const bytes = [...new TextEncoder().encode(payload)];
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error('Nội dung QR chấm công quá dài');
  const bits: number[] = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);

  const data: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[offset + bit];
    data.push(byte);
  }
  let padIndex = 0;
  while (data.length < DATA_CODEWORDS) data.push(padIndex++ % 2 === 0 ? 0xec : 0x11);
  return data;
}

function allCodewords(payload: string) {
  const data = dataCodewords(payload);
  const blocks = Array.from({ length: BLOCKS }, (_, index) => {
    const blockData = data.slice(index * 32, (index + 1) * 32);
    return { data: blockData, ecc: reedSolomonRemainder(blockData, ECC_PER_BLOCK) };
  });
  const result: number[] = [];
  for (let index = 0; index < 32; index += 1) for (const block of blocks) result.push(block.data[index]);
  for (let index = 0; index < ECC_PER_BLOCK; index += 1) for (const block of blocks) result.push(block.ecc[index]);
  return result;
}

function formatBits() {
  const data = 0;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

export function createAttendanceQrMatrix(payload: string): boolean[][] {
  const matrix = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const functionModule = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const setFunction = (row: number, column: number, value: boolean) => {
    if (row < 0 || row >= SIZE || column < 0 || column >= SIZE) return;
    matrix[row][column] = value;
    functionModule[row][column] = true;
  };
  const finder = (centerRow: number, centerColumn: number) => {
    for (let rowOffset = -4; rowOffset <= 4; rowOffset += 1) {
      for (let columnOffset = -4; columnOffset <= 4; columnOffset += 1) {
        const distance = Math.max(Math.abs(rowOffset), Math.abs(columnOffset));
        setFunction(
          centerRow + rowOffset,
          centerColumn + columnOffset,
          distance !== 2 && distance !== 4,
        );
      }
    }
  };

  finder(3, 3);
  finder(3, SIZE - 4);
  finder(SIZE - 4, 3);
  for (let index = 8; index < SIZE - 8; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }
  for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
    for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
      const distance = Math.max(Math.abs(rowOffset), Math.abs(columnOffset));
      setFunction(26 + rowOffset, 26 + columnOffset, distance !== 1);
    }
  }

  const format = formatBits();
  const formatBit = (index: number) => ((format >>> index) & 1) !== 0;
  for (let index = 0; index <= 5; index += 1) setFunction(index, 8, formatBit(index));
  setFunction(7, 8, formatBit(6));
  setFunction(8, 8, formatBit(7));
  setFunction(8, 7, formatBit(8));
  for (let index = 9; index < 15; index += 1) setFunction(8, 14 - index, formatBit(index));
  for (let index = 0; index < 8; index += 1) setFunction(8, SIZE - 1 - index, formatBit(index));
  for (let index = 8; index < 15; index += 1) setFunction(SIZE - 15 + index, 8, formatBit(index));
  setFunction(SIZE - 8, 8, true);

  const bits: number[] = [];
  for (const word of allCodewords(payload)) appendBits(bits, word, 8);
  for (let index = 0; index < 7; index += 1) bits.push(0);

  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const row = upward ? SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (functionModule[row][column]) continue;
        let value = (bits[bitIndex++] ?? 0) !== 0;
        if ((row + column) % 2 === 0) value = !value;
        matrix[row][column] = value;
      }
    }
  }
  return matrix;
}

export const ATTENDANCE_QR_SIZE = SIZE;
