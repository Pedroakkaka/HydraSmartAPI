/*
 * HYDRASMART — Firmware das réguas de eletrodos (Arduino Uno)
 *
 * Duas réguas de 6 contatos, uma por bueiro, enviando o nível pela USB a 115200 baud.
 *
 * LIGAÇÃO
 *  - Bueiro 01: A0 A1 A2 A3 A4 A5  (contato mais baixo -> mais alto)  leitura ANALÓGICA
 *  - Bueiro 02: D7 D6 D5 D4 D3 D2  (contato mais baixo -> mais alto)  leitura DIGITAL
 *    (na régua montada: marrom=D7 embaixo, junto ao GND amarelo; vermelho=D2 no topo)
 *  - Em cada compartimento, um fio de referência ligado ao GND do Arduino, até o fundo.
 *  - Não acionar bombas pelos pinos do Arduino. Nunca ligar 9 V em pinos de sinal.
 *
 * POR QUE O BUEIRO 01 É ANALÓGICO
 *  Medido em bancada (06/11/2026) com água de torneira: contato seco ~990-1023,
 *  contato molhado ~420-570. A leitura digital só entende "molhado" abaixo de ~300,
 *  por isso o firmware anterior nunca detectava a água. Aqui o limiar é ajustável.
 *
 * BUEIRO 02 (pinos digitais)
 *  Os pinos D2-D7 não medem valor. Com água de torneira eles tendem a ficar "secos".
 *  Para funcionar: uma pitada de sal na água daquele compartimento, ou resistores de
 *  pull-up externos de ~220 kΩ, ou um fio de GND desencapado ao longo de toda a régua.
 *
 *  Testado em bancada (06/11/2026):
 *   - água de torneira, compartimento cheio: B02 detectava só o contato colado no GND;
 *   - com uma pitada de sal: B02 detectou os contatos corretamente (50% = 50% do B01)
 *     e o B01 passou a ler ~100 nos contatos molhados (antes ~450), com folga maior.
 *  Água salgada corrói os contatos mais rápido: trocar a água ao fim de cada dia de uso.
 *
 * MENSAGEM ENVIADA (uma por bueiro, a cada segundo)
 *  {"bueiro":1,"nivel_pct":50.0,"contatos_ativos":3,"raw":7,"adc":[427,480,565,1023,1023,1023]}
 *  {"bueiro":2,"nivel_pct":0.0,"contatos_ativos":0,"raw":0}
 *  {"bueiro":1,"erro":"CONTATOS_INCONSISTENTES","raw":5}   (contato alto molhado com um mais baixo seco)
 */

// ---------- Ajustes ----------
const int LIMIAR_MOLHADO = 800;   // abaixo disso o contato passa a "molhado"
const int LIMIAR_SECO = 900;      // acima disso o contato volta a "seco" (histerese)
const unsigned long INTERVALO_MS = 1000;

const byte TOTAL_CONTATOS = 6;
const byte PINOS_B1[TOTAL_CONTATOS] = {A0, A1, A2, A3, A4, A5};
const byte PINOS_B2[TOTAL_CONTATOS] = {7, 6, 5, 4, 3, 2}; // do contato mais baixo ao mais alto

bool molhadoB1[TOTAL_CONTATOS] = {false, false, false, false, false, false};
unsigned long ultimaMedicao = 0;

void setup() {
  Serial.begin(115200);
  for (byte i = 0; i < TOTAL_CONTATOS; i++) {
    pinMode(PINOS_B1[i], INPUT);
    pinMode(PINOS_B2[i], INPUT);
  }
  Serial.println(F("{\"status\":\"HYDRASMART_REGUAS_V2_READY\",\"bueiros\":2,\"b1\":\"analogico\",\"b2\":\"digital\"}"));
}

// Resistor interno ligado só durante a medida: reduz a corrosão dos eletrodos.
int lerAnalogico(byte pino) {
  pinMode(pino, INPUT_PULLUP);
  delay(3);
  long soma = 0;
  for (byte i = 0; i < 8; i++) soma += analogRead(pino);
  pinMode(pino, INPUT);
  return (int)(soma / 8);
}

bool lerDigitalMolhado(byte pino) {
  pinMode(pino, INPUT_PULLUP);
  delay(3);
  byte baixos = 0;
  for (byte i = 0; i < 8; i++) if (digitalRead(pino) == LOW) baixos++;
  pinMode(pino, INPUT);
  return baixos >= 6;
}

// Envia o nível a partir da máscara de contatos molhados (bit 0 = contato mais baixo).
void enviarNivel(byte bueiro, byte mascara, const int *adc) {
  byte ativos = 0;
  bool lacuna = false;
  for (byte i = 0; i < TOTAL_CONTATOS; i++) {
    if (mascara & (1 << i)) {
      if (lacuna) {
        Serial.print(F("{\"bueiro\":"));
        Serial.print(bueiro);
        Serial.print(F(",\"erro\":\"CONTATOS_INCONSISTENTES\",\"raw\":"));
        Serial.print(mascara);
        Serial.println('}');
        return;
      }
      ativos++;
    } else {
      lacuna = true;
    }
  }

  Serial.print(F("{\"bueiro\":"));
  Serial.print(bueiro);
  Serial.print(F(",\"nivel_pct\":"));
  Serial.print(100.0 * ativos / TOTAL_CONTATOS, 1);
  Serial.print(F(",\"contatos_ativos\":"));
  Serial.print(ativos);
  Serial.print(F(",\"raw\":"));
  Serial.print(mascara);
  if (adc) {
    Serial.print(F(",\"adc\":["));
    for (byte i = 0; i < TOTAL_CONTATOS; i++) {
      if (i) Serial.print(',');
      Serial.print(adc[i]);
    }
    Serial.print(']');
  }
  Serial.println('}');
}

void loop() {
  const unsigned long agora = millis();
  if (agora - ultimaMedicao < INTERVALO_MS) return;
  ultimaMedicao = agora;

  // Bueiro 01: analógico com histerese
  int adc[TOTAL_CONTATOS];
  byte mascaraB1 = 0;
  for (byte i = 0; i < TOTAL_CONTATOS; i++) {
    adc[i] = lerAnalogico(PINOS_B1[i]);
    if (adc[i] < LIMIAR_MOLHADO) molhadoB1[i] = true;
    else if (adc[i] > LIMIAR_SECO) molhadoB1[i] = false;
    if (molhadoB1[i]) mascaraB1 |= (1 << i);
  }
  enviarNivel(1, mascaraB1, adc);

  // Bueiro 02: digital
  byte mascaraB2 = 0;
  for (byte i = 0; i < TOTAL_CONTATOS; i++) {
    if (lerDigitalMolhado(PINOS_B2[i])) mascaraB2 |= (1 << i);
  }
  enviarNivel(2, mascaraB2, nullptr);
}
