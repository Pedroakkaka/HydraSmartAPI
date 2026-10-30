/*
 * ============================================================================
 * HYDRASMART AI v2 — Firmware Oficial para Arduino Uno / Nano
 * Monitoramento de Drenagem Urbana com 2 Sensores Ultrassônicos HC-SR04
 * ============================================================================
 *
 * ESQUEMA DE PINAGEM FÍSICA:
 * - Bueiro 01 (Entrada / Montante):
 *     TRIG: Pino Digital 9  (D9)
 *     ECHO: Pino Digital 10 (D10)
 *
 * - Bueiro 02 (Saída / Jusante / Galeria):
 *     TRIG: Pino Digital 6  (D6)
 *     ECHO: Pino Digital 7  (D7)
 *
 * - Alimentação:
 *     VCC dos dois sensores -> 5V do Arduino
 *     GND dos dois sensores -> GND do Arduino
 *
 * COMUNICAÇÃO SERIAL:
 * - Baud Rate: 115200 bps (Padrão de Alta Performance) ou 9600 bps
 * - Formato: JSON por linha (uma mensagem por sensor ou combinada)
 *
 * ============================================================================
 */

// Pinos do Bueiro 01
const int B1_TRIG_PIN = 9;
const int B1_ECHO_PIN = 10;

// Pinos do Bueiro 02
const int B2_TRIG_PIN = 6;
const int B2_ECHO_PIN = 7;

// Configuração Serial
const unsigned long SERIAL_BAUD = 115200; // Ou 9600 conforme desejado
const unsigned long INTERVALO_LEITURA_MS = 1000; // 1 leitura por segundo

// Timeout máximo de eco: 25000 microssegundos (~4.3 metros)
const unsigned long TIMEOUT_ECO_US = 25000;

unsigned long ultimoEnvioMs = 0;

void setup() {
  Serial.begin(SERIAL_BAUD);
  
  // Configuração dos pinos do Sensor 1
  pinMode(B1_TRIG_PIN, OUTPUT);
  pinMode(B1_ECHO_PIN, INPUT);
  digitalWrite(B1_TRIG_PIN, LOW);

  // Configuração dos pinos do Sensor 2
  pinMode(B2_TRIG_PIN, OUTPUT);
  pinMode(B2_ECHO_PIN, INPUT);
  digitalWrite(B2_TRIG_PIN, LOW);

  delay(200);
  Serial.println("{\"status\":\"HYDRASMART_FIRMWARE_V2_READY\",\"baud\":115200}");
}

/**
 * Realiza a leitura da distância em centímetros de um sensor ultrassônico HC-SR04.
 * Aplica pulso de trigger de 10 microssegundos e mede o tempo de eco.
 * Retorna -1.0 em caso de timeout ou leitura fora de alcance.
 */
float medirDistanciaCm(int trigPin, int echoPin) {
  // Garante pulso limpo em LOW
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  // Dispara pulso de 10 microssegundos em HIGH
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // Mede tempo de resposta em microssegundos
  unsigned long duracaoUs = pulseIn(echoPin, HIGH, TIMEOUT_ECO_US);

  if (duracaoUs == 0) {
    return -1.0; // Sem eco (fora de alcance ou obstáculo absorvente)
  }

  // Velocidade do som no ar: 343 m/s = 0.0343 cm/us
  // Distância = (tempo * 0.0343) / 2
  float distanciaCm = (duracaoUs * 0.0343) / 2.0;

  // Filtro de limites físicos válidos do HC-SR04 (2 cm a 400 cm)
  if (distanciaCm < 2.0 || distanciaCm > 400.0) {
    return -1.0;
  }

  return distanciaCm;
}

/**
 * Realiza 3 amostras rápidas e retorna a média para amortecer ruídos pontuais.
 */
float medirDistanciaEstavel(int trigPin, int echoPin) {
  float soma = 0.0;
  int validas = 0;

  for (int i = 0; i < 3; i++) {
    float d = medirDistanciaCm(trigPin, echoPin);
    if (d > 0.0) {
      soma += d;
      validas++;
    }
    delay(15); // Pequeno intervalo entre pulsos
  }

  if (validas == 0) return -1.0;
  return soma / validas;
}

void loop() {
  unsigned long agora = millis();

  if (agora - ultimoEnvioMs >= INTERVALO_LEITURA_MS) {
    ultimoEnvioMs = agora;

    // Leitura independente dos dois bueiros físicos
    float distB1 = medirDistanciaEstavel(B1_TRIG_PIN, B1_ECHO_PIN);
    float distB2 = medirDistanciaEstavel(B2_TRIG_PIN, B2_ECHO_PIN);

    // Envio do Bueiro 01 em JSON (se a leitura for válida)
    if (distB1 > 0.0) {
      Serial.print("{\"bueiro\":1,\"dist_cm\":");
      Serial.print(distB1, 1);
      Serial.print(",\"raw\":");
      Serial.print((int)(distB1 * 10));
      Serial.println("}");
    } else {
      Serial.println("{\"bueiro\":1,\"erro\":\"FORA_DE_ALCANCE\"}");
    }

    // Pequeno intervalo entre os dois sensores para não haver interferência de eco
    delay(30);

    // Envio do Bueiro 02 em JSON (se a leitura for válida)
    if (distB2 > 0.0) {
      Serial.print("{\"bueiro\":2,\"dist_cm\":");
      Serial.print(distB2, 1);
      Serial.print(",\"raw\":");
      Serial.print((int)(distB2 * 10));
      Serial.println("}");
    } else {
      Serial.println("{\"bueiro\":2,\"erro\":\"FORA_DE_ALCANCE\"}");
    }
  }
}
