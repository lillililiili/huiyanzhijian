# Multi-stage build for Huiyan Java Backend
FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY apps/platform-java/pom.xml ./
RUN mvn dependency:go-offline -B || true
COPY apps/platform-java/src ./src
RUN mvn clean package -DskipTests -B

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

ENV PORT=4192
ENV DB_HOST=database
ENV DB_PORT=5432
ENV DB_NAME=huiyan_b1
ENV DB_USER=hy_runtime

EXPOSE 4192
ENTRYPOINT ["java", "-jar", "app.jar"]
